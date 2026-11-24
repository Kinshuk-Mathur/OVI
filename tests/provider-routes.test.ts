import assert from "node:assert/strict";
import { test } from "node:test";
import { POST as chat } from "../app/api/ai/chat/route";
import { POST as voice } from "../app/api/voice/transcribe/route";
import { readReply } from "../lib/conversations/stream-client";
import { makeWav, sampleRate } from "../lib/voice/wav";
import { db } from "../lib/server/firebase";
if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST)
  throw new Error("Run with the Firebase demo emulators.");
Object.assign(process.env, {
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-ovi",
  GROQ_API_KEY: "test-fixture",
  OVI_ORG_AUDIO_SECONDS_HOUR: "7200",
  OVI_ORG_AUDIO_SECONDS_DAY: "28800",
  OVI_CHAT_BURST: "4", // Exercise four distinct stream outcomes within one test minute.
  OVI_ORG_RPM: "30",
  OVI_ORG_RPD: "300",
  OVI_ORG_TPM: "6000",
  OVI_ORG_TPD: "150000",
});

test("real route authentication, journal consent, streaming, transcription and private usage records", async (t) => {
  const signup = await fetch(
    "http://" +
      process.env.FIREBASE_AUTH_EMULATOR_HOST +
      "/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: crypto.randomUUID() + "@example.test",
        password: "test-only-secret",
        returnSecureToken: true,
      }),
    },
  );
  const { idToken, localId } = await signup.json();
  assert.ok(idToken);
  const network = globalThis.fetch,
    calls: string[] = [];
  let streamMode = "success";
  let upstreamAborted = false;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://api.groq.com/")) return network(input, init);
    calls.push(url);
    if (url.endsWith("transcriptions")) {
      const form = init?.body as FormData;
      assert.equal(form.get("model"), "whisper-large-v3-turbo");
      assert.equal(form.has("language"), false);
      assert.match(String(form.get("prompt")), /switches languages/);
      return Response.json({ text: "आज मौसम अच्छा है।" });
    }
    const params = JSON.parse(String(init?.body));
    assert.equal(params.model, "openai/gpt-oss-120b");
    assert.equal(params.include_reasoning, false);
    if (streamMode === "reject") return Response.json({ error: "private provider body" }, { status: 401 });
    assert.equal(JSON.parse(params.messages.at(-1).content).selectedJournalExcerpt, "Synthetic Saturday");
    const text = 'data: {"choices":[{"delta":{"content":"Tell me more.","reasoning":"hidden"}}]}\n\n';
    if (streamMode === "cancel") {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(text));
            init?.signal?.addEventListener(
              "abort",
              () => {
                upstreamAborted = true;
                controller.error(new DOMException("Stopped", "AbortError"));
              },
              { once: true },
            );
          },
        }),
      );
    }
    const end =
      'data: {"choices":[{"finish_reason":"stop"}],"x_groq":{"usage":{"prompt_tokens":90,"completion_tokens":10,"prompt_tokens_details":{"cached_tokens":20}}}}\n\ndata: [DONE]\n\n';
    return new Response(text + (streamMode === "success" ? end : ""));
  });
  const call = () =>
    chat(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + idToken },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          message: "How was Saturday?",
          journal: "Synthetic Saturday",
          history: [],
        }),
      }),
    );
  const first = await call();
  assert.equal(first.status, 200);
  assert.equal(await readReply(first, () => {}), "Tell me more.");
  streamMode = "break";
  await assert.rejects(
    readReply(await call(), () => {}),
    /interrupted/,
  );
  streamMode = "reject";
  const failed = await call();
  assert.equal(failed.status, 503);
  assert.ok(!(await failed.text()).includes("private provider body"));
  streamMode = "cancel";
  const streaming = await call();
  assert.equal(streaming.status, 200);
  const reader = streaming.body!.getReader();
  await reader.read();
  await reader.cancel();
  assert.ok(upstreamAborted);
  const wav = makeWav([new Float32Array(sampleRate)], sampleRate);
  const transcript = await voice(
    new Request("http://localhost/api/voice/transcribe", {
      method: "POST",
      headers: {
        "Content-Type": "audio/wav",
        Authorization: "Bearer " + idToken,
        "X-Request-Id": crypto.randomUUID(),
      },
      body: wav,
    }),
  );
  assert.equal(transcript.status, 200);
  assert.equal((await transcript.json()).text, "आज मौसम अच्छा है।");
  const records = await db().collection("quotaReservations").where("uid", "==", localId).get();
  assert.equal(records.size, 5);
  const metrics = records.docs.map((d) => d.data());
  assert.ok(metrics.some((r) => r.usage?.cached === 20));
  const stored = JSON.stringify(metrics);
  for (const privateText of ["Synthetic Saturday", "Tell me more", "आज मौसम", "hidden"])
    assert.ok(!stored.includes(privateText));
  assert.equal(calls.length, 5);
});
