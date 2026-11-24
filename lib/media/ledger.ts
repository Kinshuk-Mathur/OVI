/** Trusted byte and slot accounting for Firebase Storage. Every mutation is scoped to a verified owner and uses Firestore transactions. */
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { bucket, db } from "../server/firebase";
import { dayOf, photoMaxBytes, policy, resetAt } from "../ai/policy";
import { invalid, PublicError } from "../server/http";

const leaseMs = 10 * 60000;
export function mediaIds(body: Record<string, unknown>) {
  const { journalId, mediaId } = body;
  if (
    typeof journalId !== "string" ||
    typeof mediaId !== "string" ||
    ![journalId, mediaId].every((id) => /^[\w-]{1,128}$/.test(id))
  )
    throw invalid();
  return { journalId, mediaId };
}
function location(uid: string, journalId: string, mediaId: string) {
  const account = db().doc(`mediaUsage/${uid}`),
    journal = account.collection("journals").doc(journalId);
  return {
    account,
    journal,
    ticket: journal.collection("objects").doc(mediaId),
    file: bucket().file(`users/${uid}/journal-media/${journalId}/${mediaId}`),
  };
}
async function sizeOf(file: ReturnType<typeof location>["file"]) {
  try {
    return Number((await file.getMetadata())[0].size);
  } catch (error) {
    if ((error as { code?: number }).code === 404) return null;
    throw error;
  }
}
/** First use adopts the user's pre-quota objects using trusted bucket sizes. New writes are
 * impossible until both baselines exist. Stream the listing to avoid buffering old photo data. */
export async function ensureMediaAccount(uid: string, journalId?: string) {
  const account = db().doc(`mediaUsage/${uid}`),
    root = `users/${uid}/journal-media/`;
  const targets = [{ ref: account, prefix: root, field: "bytes" }];
  if (journalId)
    targets.push({
      ref: account.collection("journals").doc(journalId),
      prefix: root + journalId + "/",
      field: "count",
    });
  for (const { ref, prefix, field } of targets) {
    if ((await ref.get()).exists) continue;
    let total = 0;
    for await (const file of bucket().getFilesStream({ prefix }))
      total += field === "bytes" ? Number(file.metadata.size) : 1;
    await db().runTransaction(async (tx) => {
      if (!(await tx.get(ref)).exists) tx.create(ref, { [field]: total });
    });
  }
}
type Pending = { journalId: string; mediaId: string; until: number };
/** Counters include holds. Revoking an expired authorization before inspecting Storage prevents
 * a retry from completing against a released slot. Existing bytes are never refunded as absent. */
export async function reconcile(uid: string, journalId: string, mediaId: string, expire = false) {
  const { account, journal, ticket, file } = location(uid, journalId, mediaId);
  const state = await db().runTransaction(async (tx) => {
    const row = (await tx.get(ticket)).data();
    if (!row) throw new PublicError(409, "This photo needs upload authorization.");
    if (row.state === "reserved" && expire && row.until.toMillis() <= Date.now()) {
      tx.update(ticket, { state: "checking" });
      return "checking";
    }
    return row.state as string;
  });
  if (state === "stored") return;
  if (!["checking", "reserved"].includes(state))
    throw new PublicError(409, "This photo is no longer pending.");
  const actual = await sizeOf(file);
  if (actual === null && state !== "checking")
    throw new PublicError(409, "The photo upload has not finished.");
  await db().runTransaction(async (tx) => {
    const [record, summary] = await tx.getAll(ticket, account),
      row = record.data()!;
    if (row.state !== state) return;
    if (actual !== null && actual !== row.size) throw new Error("Encrypted size mismatch");
    const pending: Pending[] = summary.get("pending") ?? [];
    tx.update(account, {
      pending: pending.filter((p) => p.journalId !== journalId || p.mediaId !== mediaId),
      reservedBytes: FieldValue.increment(-row.size),
      bytes: FieldValue.increment(actual === null ? -row.size : 0),
    });
    if (actual === null) {
      tx.update(journal, { count: FieldValue.increment(-1) });
      tx.update(account.collection("days").doc(row.day), { uploads: FieldValue.increment(-1) });
      tx.delete(ticket);
    } else tx.update(ticket, { state: "stored" });
  });
}
/** Lazy reconciliation avoids a scheduled worker. Opening usage or requesting another slot
 * first settles any ten-minute holds abandoned by this owner. */
export async function releaseExpiredPhotos(uid: string) {
  const account = db().doc(`mediaUsage/${uid}`);
  const pending: Pending[] = (await account.get()).get("pending") ?? [];
  for (const p of pending.filter((item) => item.until <= Date.now())) {
    await reconcile(uid, p.journalId, p.mediaId, true);
  }
}
export async function reservePhoto(uid: string, journalId: string, mediaId: string, size: unknown) {
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 1 || size > photoMaxBytes)
    throw invalid("Photos must be under 5 MB after encryption.");
  await ensureMediaAccount(uid, journalId);
  const { account, journal, ticket, file } = location(uid, journalId, mediaId);
  await releaseExpiredPhotos(uid);
  const limits = policy(),
    now = Date.now(),
    day = dayOf(now),
    daily = account.collection("days").doc(day);
  return db().runTransaction(async (tx) => {
    const [record, usage, count, today] = await tx.getAll(ticket, account, journal, daily);
    if (record.exists) {
      if (record.get("size") !== size || !["reserved", "stored"].includes(record.get("state")))
        throw new PublicError(409, "Photo authorization changed. Please retry.");
      return { stored: record.get("state") === "stored" };
    }
    // The transaction has read the ticket. A concurrent deletion or creation invalidates this
    // read and retries the metadata check, including for photos predating the ledger.
    const existingSize = await sizeOf(file);
    if (existingSize !== null) {
      if (existingSize !== size) throw new PublicError(409, "This photo identifier already exists.");
      tx.create(ticket, { state: "stored", size });
      return { stored: true };
    }
    if ((today.get("uploads") ?? 0) >= limits.dailyPhotos)
      throw new PublicError(429, "You've reached today's photo upload limit.", resetAt(now), "photo_daily");
    if (count.get("count") >= limits.journalPhotos)
      throw new PublicError(409, "This journal has reached its photo limit.", undefined, "photo_count");
    if (usage.get("bytes") + size > limits.storageBytes)
      throw new PublicError(
        409,
        "Your photo storage is full. Remove some older images to make room.",
        undefined,
        "photo_storage",
      );
    const until = now + leaseMs;
    tx.create(ticket, { state: "reserved", size, day, until: Timestamp.fromMillis(until) });
    tx.update(account, {
      bytes: FieldValue.increment(size),
      reservedBytes: FieldValue.increment(size),
      pending: FieldValue.arrayUnion({ journalId, mediaId, until }),
    });
    tx.update(journal, { count: FieldValue.increment(1) });
    tx.set(daily, { uploads: FieldValue.increment(1) }, { merge: true });
    return { stored: false };
  });
}
/** The client calls this only after committing the encrypted journal revision without the photo.
 * A deleting tombstone blocks re-authorization. Generation checks protect a replacement object. */
export async function removePhoto(uid: string, journalId: string, mediaId: string, revision: unknown) {
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1) throw invalid();
  await ensureMediaAccount(uid, journalId);
  const { account, journal, ticket, file } = location(uid, journalId, mediaId);
  const metadata = await file
    .getMetadata()
    .then(([m]) => m)
    .catch((error) => {
      if (error.code === 404) return null;
      throw error;
    });
  const generation = await db().runTransaction(async (tx) => {
    const [record, draft] = await tx.getAll(ticket, db().doc(`users/${uid}/journals/${journalId}`));
    if (draft.get("revision") !== revision)
      throw new PublicError(409, "The journal changed on another device.");
    if (record.get("state") === "deleting") return record.get("generation") as number;
    if (record.exists && record.get("state") !== "stored")
      throw new PublicError(409, "This photo is still uploading.");
    if (!metadata) return null;
    const generation = Number(metadata.generation);
    tx.set(ticket, { state: "deleting", size: Number(metadata.size), generation });
    return generation;
  });
  if (generation === null) return;
  // Bind retries to the original object generation. A delayed remover cannot erase a later upload.
  try {
    await file.delete({ ifGenerationMatch: generation });
  } catch (error) {
    if ((error as { code?: number }).code !== 404) throw error;
  }
  await db().runTransaction(async (tx) => {
    const row = await tx.get(ticket);
    if (row.get("state") !== "deleting" || row.get("generation") !== generation) return;
    tx.update(account, { bytes: FieldValue.increment(-row.get("size")) });
    tx.update(journal, { count: FieldValue.increment(-1) });
    tx.delete(ticket);
  });
}
