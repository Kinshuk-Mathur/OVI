import assert from "node:assert/strict";
import { test } from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import { reserve, settle } from "../lib/server/quota";
import { db, authenticatedUid } from "../lib/server/firebase";
import { reservePhoto, reconcile, removePhoto } from "../lib/media/ledger";
import { dayOf, resetAt, photoMaxBytes } from "../lib/ai/policy";

// Refuse to run these operations on a real project.
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST)
  throw new Error("Start all Firebase emulators for demo-ovi.");
Object.assign(process.env, {
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-quota-" + crypto.randomUUID().slice(0, 8),
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "demo-ovi.appspot.com",
  OVI_ORG_AUDIO_SECONDS_HOUR: "7200",
  OVI_ORG_AUDIO_SECONDS_DAY: "28800",
  OVI_ORG_RPM: "100",
  OVI_ORG_TPM: "6000",
  OVI_ORG_TPD: "150000",
  OVI_ORG_RPD: "1000",
  OVI_ORG_CONCURRENCY: "3",
});
const uid = () => crypto.randomUUID();
const done = {
  model: "openai/gpt-oss-120b",
  category: "complete" as const,
  usage: { input: 50, output: 15, cached: 20 },
};
const isCode = (code: string) => (e: unknown) => (e as { code: string }).code === code;
test("Firebase denies an invalid identity token", async () => {
  await assert.rejects(
    authenticatedUid(new Request("http://localhost", { headers: { authorization: "Bearer invalid" } })),
    isCode("auth"),
  );
});
test("30 accepted messages, UTC reset and rolling minute across midnight", async () => {
  const id = uid(),
    start = resetAt(Date.now()) + 3600000;
  for (let i = 0; i < 30; i++)
    await settle(await reserve(id, "chat", uid(), 100, 0, start + i * 61000), done);
  await assert.rejects(reserve(id, "chat", uid(), 100, 0, start + 30 * 61000), isCode("chat_daily"));
  const ticket = await reserve(id, "chat", uid(), 100, 0, resetAt(start));
  await settle(ticket, done);
  const next = uid(),
    midnight = resetAt(start) + 86400000;
  for (let i = 3; i > 0; i--)
    await settle(await reserve(next, "chat", uid(), 100, 0, midnight - i * 1000), done);
  await assert.rejects(reserve(next, "chat", uid(), 100, 0, midnight + 1000), isCode("burst"));
});
test("atomic active leases, duplicate IDs, retries, token usage, ambiguous failure and global 429", async () => {
  const id = uid(),
    at = resetAt(Date.now()) + 5 * 86400000;
  const results = await Promise.allSettled([
    reserve(id, "chat", uid(), 500, 0, at),
    reserve(id, "chat", uid(), 500, 0, at),
  ]);
  const accepted = results.filter((r) => r.status === "fulfilled");
  assert.equal(accepted.length, 1);
  const r = accepted[0].value;
  await settle(r, done);
  await settle(r, done);
  const day = await db()
    .doc("systemUsage/" + dayOf(at))
    .get();
  assert.equal(day.get("tokens"), 45);
  const requestId = uid(),
    rejected = await reserve(id, "chat", requestId, 300, 0, at + 61000);
  await settle(rejected, { model: done.model, category: "rejected", retryAt: at + 90000 });
  await assert.rejects(reserve(id, "chat", requestId, 300, 0, at + 92000));
  await assert.rejects(reserve(uid(), "chat", uid(), 300, 0, at + 70000), isCode("capacity"));
  const uncertain = await reserve(id, "chat", uid(), 300, 0, at + 92000);
  await settle(uncertain, { model: done.model, category: "interrupted" });
  assert.equal((await day.ref.get()).get("tokens"), 345);
  await assert.rejects(reserve(uid(), "chat", uid(), 6001, 0, at + 180000), isCode("capacity"));
});
test("voice reserves actual seconds, rejects concurrent transcription and exhausts at 600 seconds", async () => {
  const id = uid(),
    at = resetAt(Date.now()) + 10 * 86400000;
  for (let i = 0; i < 5; i++) {
    const r = await reserve(id, "voice", uid(), 0, 120, at + i * 61000);
    await assert.rejects(reserve(id, "voice", uid(), 0, 1, at + i * 61000), isCode("busy"));
    await settle(r, { model: "whisper-large-v3-turbo", category: "complete" });
  }
  await assert.rejects(reserve(id, "voice", uid(), 0, 1, at + 360000), isCode("voice_daily"));
});
test("photo holds enforce sizes, concurrency, daily count, per-journal count and expiration", async () => {
  const owner = uid(),
    journal = "j",
    acct = db().doc("mediaUsage/" + owner);
  await assert.rejects(reservePhoto(owner, journal, "too-big", photoMaxBytes + 1));
  for (let i = 0; i < 19; i++) await reservePhoto(owner, journal, "photo" + i, 128);
  const results = await Promise.allSettled([
    reservePhoto(owner, journal, "p19", 128),
    reservePhoto(owner, journal, "p20", 128),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  await assert.rejects(reservePhoto(owner, "other", "extra", 128), isCode("photo_daily"));
  await acct.collection("days").doc(dayOf(Date.now())).update({ uploads: 0 });
  await assert.rejects(reservePhoto(owner, journal, "extra", 128), isCode("photo_count"));
  const ticket = acct.collection("journals").doc(journal).collection("objects").doc("photo0");
  await ticket.update({ until: Timestamp.fromMillis(Date.now() - 1) });
  await reconcile(owner, journal, "photo0", true);
  assert.equal((await acct.get()).get("bytes"), 19 * 128);
  assert.equal((await ticket.get()).exists, false);
  await acct.update({ bytes: 250 * 1024 * 1024 });
  await assert.rejects(reservePhoto(owner, "other", "full", 1), isCode("photo_storage"));
});
test("legacy object bytes are adopted once, completion verifies remote storage, deletion preserves daily spend", async () => {
  const { bucket } = await import("../lib/server/firebase"),
    owner = uid(),
    name = "j",
    id = "old";
  const file = bucket().file(`users/${owner}/journal-media/${name}/${id}`),
    acct = db().doc("mediaUsage/" + owner);
  await file.save(Buffer.from([1, 2, 3]), { resumable: false });
  assert.deepEqual(await reservePhoto(owner, name, id, 3), { stored: true });
  const fresh = "new";
  await reservePhoto(owner, name, fresh, 5);
  await assert.rejects(reconcile(owner, name, fresh));
  await bucket()
    .file(`users/${owner}/journal-media/${name}/${fresh}`)
    .save(Buffer.alloc(5), { resumable: false });
  await reconcile(owner, name, fresh);
  await reconcile(owner, name, fresh);
  assert.equal((await acct.get()).get("bytes"), 8);
  await db().doc(`users/${owner}/journals/${name}`).set({ revision: 2 });
  await assert.rejects(removePhoto(owner, name, fresh, 1));
  await removePhoto(owner, name, fresh, 2);
  await removePhoto(owner, name, fresh, 2);
  assert.equal((await acct.get()).get("bytes"), 3);
  assert.equal((await acct.collection("days").doc(dayOf(Date.now())).get()).get("uploads"), 1);
});
