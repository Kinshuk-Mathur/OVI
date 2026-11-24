"use client";

import { getBytes, getMetadata, ref, uploadBytes } from "firebase/storage";
import { getFirebaseServices } from "@/lib/firebase/client";
import { decryptRecord, encryptRecord, type EncryptedRecord } from "@/lib/security/vault";

import { api, jsonPost } from "@/lib/firebase/api-client";
import { preparePhoto } from "@/lib/media/prepare-photo";
import { photoMaxBytes } from "@/lib/ai/policy";

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
  if (file.size * 4 / 3 + 2048 > photoMaxBytes) file = await preparePhoto(file);
  const mime = new TextEncoder().encode(file.type), bytes = new Uint8Array(await file.arrayBuffer());
  const payload = new Uint8Array(1 + mime.length + bytes.length); payload[0] = mime.length; payload.set(mime, 1); payload.set(bytes, 1 + mime.length);
  try {
    const encrypted = JSON.stringify(await encryptRecord(key, uid, mediaKey(journalId, mediaId), payload));
    if (encrypted.length > photoMaxBytes) throw new Error("Photo exceeds the encrypted upload limit.");
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
export async function uploadPendingPhotos(uid: string, journalId: string, referencedIds?: string[], key?: CryptoKey): Promise<void> {
  const selected: MediaRecord[] = [];
  if (referencedIds) {
    // Query individual keys. Loading all encrypted images per reference makes a 20-photo
    // journal unnecessarily expensive on mobile, even when the user edits only one picture.
    for (const id of new Set(referencedIds)) {
      const record = await read(uid,journalId,id);
      if (record) selected.push(record);
      else await getMetadata(ref(getFirebaseServices().storage,path(uid,journalId,id)));
    }
  } else selected.push(...await list(uid,journalId));
  for (let media of selected) {
    const object = ref(getFirebaseServices().storage, path(uid, journalId, media.mediaId));
    if (media.uploaded) {
      // Undo, conflict copies, and another device can reintroduce a previously deleted photo.
      try { await getMetadata(object); continue; }
      catch (error) { if ((error as { code?: string }).code !== "storage/object-not-found") throw error; }
      await write({ ...media, uploaded: false });
    }
    // A pending pre-quota photo may exceed today's object limit. If its upload committed
    // earlier, verify and keep the original. Otherwise re-encode it with the unlocked key.
    if (media.encrypted.length > photoMaxBytes && key) {
      try {
        const remote = await getBytes(object,20 * 1024 * 1024);
        if (new TextDecoder().decode(remote) !== media.encrypted) throw new Error("Photo identifier collision.");
        await write({ ...media,uploaded:true }); continue;
      } catch (error) { if ((error as {code?: string}).code !== "storage/object-not-found") throw error; }
      const original = await getEncryptedPhoto(uid,key,journalId,media.mediaId);
      if (!original) throw new Error("Local photo unavailable.");
      await saveEncryptedPhoto(uid,key,journalId,media.mediaId,await preparePhoto(original));
      media = (await read(uid,journalId,media.mediaId))!;
    }
    const bytes = new TextEncoder().encode(media.encrypted);
    const ids = { journalId, mediaId: media.mediaId };
    const { stored } = await (await api("/api/media/reserve", jsonPost({ ...ids, size: bytes.length }))).json();
    try {
      // Reuse the same immutable ID after a lost response. Verify existing ciphertext before acknowledgement.
      if (stored) throw new Error("Verify previously stored photo");
      await uploadBytes(object, bytes, { contentType: "application/octet-stream", customMetadata: { encryptionVersion: "1" } });
    } catch (error) {
      // A previous upload may have committed even if its response was lost. Verify exact bytes.
      let remote: Uint8Array;
      try { remote = new Uint8Array(await getBytes(object, 20 * 1024 * 1024)); } catch { throw error; }
      if (remote.length !== bytes.length || remote.some((byte, index) => byte !== bytes[index])) throw error;
    }
    await api("/api/media/complete", jsonPost(ids));
    await write({ ...media, uploaded: true });
  }
}
