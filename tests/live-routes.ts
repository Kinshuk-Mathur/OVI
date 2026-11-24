/**
 * Opt-in live acceptance run. Only inference leaves this machine. Authentication, encrypted
 * messages and quota counters stay in the demo Firebase emulators. Each synthetic case uses
 * a separate conversation context so earlier answers cannot leak into a later evaluation.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { loadEnvConfig } from "@next/env";
import { createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { getDocFromServer, doc } from "firebase/firestore";
import "fake-indexeddb/auto";
import { getFirebaseServices } from "../lib/firebase/client";
import { createVault, unlockVault } from "../lib/security/vault";
import { createVaultOnce, loadVault } from "../lib/firebase/repository";
import { checkpointMessage, syncOutbox, watchMessages } from "../lib/conversations/repository";
import { POST as chat } from "../app/api/ai/chat/route";
import { POST as voice } from "../app/api/voice/transcribe/route";
import { GET as usage } from "../app/api/account/usage/route";
import { readReply } from "../lib/conversations/stream-client";
import { wavDuration } from "../lib/voice/wav";
import { db } from "../lib/server/firebase";
import scenarios from "./ai-evaluations.json";

async function run() {
  if (
    !["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST"].every((k) =>
      process.env[k]?.startsWith("127.0.0.1:"),
    )
  ) {
    throw new Error("Run with the three local Firebase emulators and the demo-ovi project.");
  }
  loadEnvConfig(process.cwd());
  assert.ok(process.env.GROQ_API_KEY, "Set GROQ_API_KEY before opting into live evaluation.");
  Object.assign(process.env, {
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-ovi",
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "demo-ovi.appspot.com",
    NEXT_PUBLIC_FIREBASE_API_KEY: "demo-key",
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "demo-ovi.firebaseapp.com",
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "123",
    NEXT_PUBLIC_FIREBASE_APP_ID: "1:123:web:demo",
    NEXT_PUBLIC_FIREBASE_USE_EMULATORS: "true",
    // These are small test ceilings for this disposable run, independent of production settings.
    OVI_ORG_RPM: "6",
    OVI_ORG_RPD: "20",
    OVI_ORG_TPM: "6000",
    OVI_ORG_TPD: "35000",
    OVI_ORG_CONCURRENCY: "1",
    OVI_ORG_AUDIO_SECONDS_HOUR: "120",
    OVI_ORG_AUDIO_SECONDS_DAY: "120",
    FIREBASE_ADMIN_CREDENTIALS: "",
  });
  Object.defineProperty(globalThis, "window", { value: new EventTarget(), configurable: true });
  const services = getFirebaseServices();
  const user = (
    await createUserWithEmailAndPassword(
      services.auth,
      crypto.randomUUID() + "@example.test",
      "Synthetic login password",
    )
  ).user;
  const token = await user.getIdToken(),
    headers = { Authorization: "Bearer " + token };
  const password = "Synthetic journal vault passphrase",
    vault = await createVault(user.uid, password);
  await createVaultOnce(user.uid, vault.metadata, "Evaluation");
  try {
    let seconds = 0;
    for (const file of process.argv.slice(2)) {
      const bytes = await readFile(file),
        duration = wavDuration(bytes);
      assert.ok(duration, "Provide a canonical 16 kHz mono WAV.");
      const res = await voice(
        new Request("http://localhost/api/voice/transcribe", {
          method: "POST",
          headers: { ...headers, "Content-Type": "audio/wav", "X-Request-Id": crypto.randomUUID() },
          body: new Uint8Array(bytes),
        }),
      );
      const body = await res.json();
      assert.equal(res.status, 200, body.error);
      assert.ok(body.text.trim());
      seconds += duration;
      console.log(
        JSON.stringify({ kind: "transcript", file: file.split("/").pop(), duration, text: body.text }),
      );
    }
    let firstAssistantId = "",
      firstAnswer = "";
    for (const [index, scenario] of scenarios.entries()) {
      // Space admissions below the real application rolling-minute limit. No automatic retry
      // after a provider error, since generation may have incurred cost.
      if (index) await delay(21000);
      const thread = "live-" + index,
        userId = crypto.randomUUID(),
        at = Date.now();
      await checkpointMessage(user.uid, vault.masterKey, thread, {
        id: userId,
        role: "user",
        text: scenario.message,
        at,
      });
      await syncOutbox(user.uid, vault.masterKey, thread);
      const res = await chat(
        new Request("http://localhost/api/ai/chat", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: crypto.randomUUID(),
            message: scenario.message,
            history: scenario.history ?? [],
          }),
        }),
      );
      if (!res.ok) {
        const body = await res.json();
        throw new Error("Live chat HTTP " + res.status + " " + body.error);
      }
      let frames = 0;
      const reply = await readReply(res, () => {
        frames++;
      });
      assert.ok(frames > 0);
      const assistantId = crypto.randomUUID();
      await checkpointMessage(user.uid, vault.masterKey, thread, {
        id: assistantId,
        role: "assistant",
        text: reply,
        at: Date.now(),
      });
      await syncOutbox(user.uid, vault.masterKey, thread);
      if (index === 0) {
        firstAssistantId = assistantId;
        firstAnswer = reply;
      }
      console.log(JSON.stringify({ kind: "reply", case: scenario.case, frames, text: reply }));
    }
    const cloud = await getDocFromServer(
      doc(services.db, "users", user.uid, "conversations", "live-0", "messages", firstAssistantId),
    );
    assert.ok(cloud.exists());
    assert.ok(!JSON.stringify(cloud.data()).includes(firstAnswer));
    const restored = await unlockVault(user.uid, password, (await loadVault(user.uid))!);
    const recovered = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error("Encrypted reply restore timed out"));
      }, 10000);
      const unsubscribe = watchMessages(
        user.uid,
        restored,
        "live-0",
        (page) => {
          const answer = page.rows.find((row) => row.id === firstAssistantId);
          if (answer) {
            clearTimeout(timer);
            unsubscribe();
            resolve(answer.text);
          }
        },
        () => {
          clearTimeout(timer);
          unsubscribe();
          reject(new Error("History read failed"));
        },
      );
    });
    assert.equal(recovered, firstAnswer);
    const summary = await (
      await usage(new Request("http://localhost/api/account/usage", { headers }))
    ).json();
    assert.equal(summary.messages, 30 - scenarios.length);
    assert.equal(summary.voiceSeconds, 600 - seconds);
    const tickets = (await db().collection("quotaReservations").where("uid", "==", user.uid).get()).docs.map(
      (d) => d.data(),
    );
    assert.equal(tickets.length, scenarios.length + process.argv.slice(2).length);
    assert.ok(tickets.every((t) => t.state === "complete"));
    assert.ok(tickets.filter((t) => t.kind === "chat").every((t) => t.usage.input > 0 && t.usage.output > 0));
    console.log(
      JSON.stringify({
        kind: "verified",
        restored: true,
        messagesRemaining: summary.messages,
        voiceSecondsRemaining: summary.voiceSeconds,
        cacheReports: tickets.filter((t) => t.usage?.cached !== undefined).length,
        cacheHits: tickets.filter((t) => t.usage?.cached > 0).length,
      }),
    );
  } finally {
    await signOut(services.auth);
  }
}
run().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
