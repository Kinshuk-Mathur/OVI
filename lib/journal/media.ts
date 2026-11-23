"use client";

import { getBytes, getMetadata, ref, uploadBytes } from "firebase/storage";
import { getFirebaseServices } from "@/lib/firebase/client";
import { decryptRecord, encryptRecord, type EncryptedRecord } from "@/lib/security/vault";

interface MediaRecord { uid: string; journalId: string; mediaId: string; encrypted: string; uploaded: boolean }
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
let dbPromise: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("ovi-encrypted-media", 1);
    request.onupgradeneeded = () => { const store = request.result.createObjectStore("media", { keyPath: ["uid", "journalId", "mediaId"] }); store.createIndex("ownerJournal", ["uid", "journalId"]); };
    request.onsuccess = () => { const value = request.result; value.onversionchange = () => { value.close(); dbPromise = undefined; }; resolve(value); };
    request.onerror = () => reject(request.error ?? new Error("Unable to open encrypted photo storage."));
    request.onblocked = () => reject(new Error("Encrypted photo storage is blocked."));
  }).catch((error) => { dbPromise = undefined; throw error; });
  return dbPromise;
}
async function read(uid: string, journalId: string, mediaId: string): Promise<MediaRecord | undefined> {
  const database = await db();
  return new Promise((resolve, reject) => { const tx = database.transaction("media", "readonly"); const req = tx.objectStore("media").get([uid, journalId, mediaId]); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); tx.onabort = () => reject(tx.error); });
}
async function write(record: MediaRecord): Promise<void> {
  const database = await db();
  return new Promise((resolve, reject) => { const tx = database.transaction("media", "readwrite"); tx.objectStore("media").put(record); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error("Unable to save photo.")); tx.onerror = () => {}; });
}
async function list(uid: string, journalId: string): Promise<MediaRecord[]> {
  const database = await db();
  return new Promise((resolve, reject) => { const tx = database.transaction("media", "readonly"); const req = tx.objectStore("media").index("ownerJournal").getAll([uid, journalId]); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); tx.onabort = () => reject(tx.error); });
}
const mediaKey = (journalId: string, mediaId: string) => JSON.stringify(["media", journalId, mediaId]);
const path = (uid: string, journalId: string, mediaId: string) => `users/${uid}/journal-media/${journalId}/${mediaId}`;

/** A photo is inserted into the editor only after its ciphertext is committed locally. */
export async function saveEncryptedPhoto(uid: string, key: CryptoKey, journalId: string, mediaId: string, file: Blob): Promise<void> {
  if (!allowedTypes.has(file.type) || file.size <= 0 || file.size > 12 * 1024 * 1024) throw new Error("Unsupported photo.");
  const mime = new TextEncoder().encode(file.type), bytes = new Uint8Array(await file.arrayBuffer());
  const payload = new Uint8Array(1 + mime.length + bytes.length); payload[0] = mime.length; payload.set(mime, 1); payload.set(bytes, 1 + mime.length);
  try {
    const encrypted = JSON.stringify(await encryptRecord(key, uid, mediaKey(journalId, mediaId), payload));
    await write({ uid, journalId, mediaId, encrypted, uploaded: false });
  } finally { bytes.fill(0); payload.fill(0); }
}
export async function getEncryptedPhoto(uid: string, key: CryptoKey, journalId: string, mediaId: string): Promise<Blob | undefined> {
  let record = await read(uid, journalId, mediaId);
  if (!record) {
    const bytes = await getBytes(ref(getFirebaseServices().storage, path(uid, journalId, mediaId)), 20 * 1024 * 1024);
    record = { uid, journalId, mediaId, encrypted: new TextDecoder().decode(bytes), uploaded: true };
    // Verify authentication before caching remote bytes.
    const verified = await decryptRecord(key, uid, mediaKey(journalId, mediaId), JSON.parse(record.encrypted) as EncryptedRecord); verified.fill(0);
    await write(record);
  }
  const bytes = await decryptRecord(key, uid, mediaKey(journalId, mediaId), JSON.parse(record.encrypted) as EncryptedRecord);
  try {
    const length = bytes[0], mime = new TextDecoder().decode(bytes.subarray(1, 1 + length));
    if (!allowedTypes.has(mime) || length < 1 || bytes.length <= length + 1) throw new Error("Invalid encrypted photo.");
    return new Blob([bytes.slice(1 + length)], { type: mime });
  } finally { bytes.fill(0); }
}
/** Upload immutable ciphertext before a cloud journal can reference it. */
export async function uploadPendingPhotos(uid: string, journalId: string, referencedIds?: string[]): Promise<void> {
  const records = await list(uid, journalId);
  const selected = referencedIds ? records.filter((item) => referencedIds.includes(item.mediaId)) : records;
  if (referencedIds) for (const mediaId of new Set(referencedIds)) {
    if (!records.some((item) => item.mediaId === mediaId)) await getMetadata(ref(getFirebaseServices().storage, path(uid, journalId, mediaId)));
  }
  for (const media of selected) {
    if (media.uploaded) continue;
    const object = ref(getFirebaseServices().storage, path(uid, journalId, media.mediaId));
    const bytes = new TextEncoder().encode(media.encrypted);
    try {
      await uploadBytes(object, bytes, { contentType: "application/octet-stream", customMetadata: { encryptionVersion: "1" } });
    } catch (error) {
      // A previous upload may have committed even if its response was lost. Verify exact bytes.
      let remote: Uint8Array;
      try { remote = new Uint8Array(await getBytes(object, 20 * 1024 * 1024)); } catch { throw error; }
      if (remote.length !== bytes.length || remote.some((byte, index) => byte !== bytes[index])) throw error;
    }
    await write({ ...media, uploaded: true });
  }
}
