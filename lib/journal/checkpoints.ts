import { decryptRecord, encryptRecord, type EncryptedRecord } from "../security/vault";

/** A branch belongs to a single editing session; distinct branches are never overwritten. */
export interface Checkpoint {
  uid: string;
  journalId: string;
  branchId: string;
  localRevision: number;
  baseCloudRevision: number;
  syncedLocalRevision: number;
  updatedAt: number;
  encrypted: EncryptedRecord;
}
export class StaleCheckpointError extends Error {
  constructor() { super("A newer local checkpoint already exists."); this.name = "StaleCheckpointError"; }
}
const DATABASE = "ovi-encrypted-checkpoints";
let databasePromise: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("branches", { keyPath: ["uid", "journalId", "branchId"] });
        store.createIndex("uid", "uid");
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); databasePromise = undefined; };
        resolve(db);
      };
      request.onerror = () => reject(request.error ?? new Error("Could not open encrypted checkpoints."));
      request.onblocked = () => reject(new Error("Encrypted checkpoint storage is blocked by another tab."));
    }).catch((error) => { databasePromise = undefined; throw error; });
  }
  return databasePromise;
}
const recordId = (journalId: string, branchId: string) => JSON.stringify(["checkpoint", journalId, branchId]);
function validateId(value: string) { if (!value || value.length > 256) throw new Error("Invalid checkpoint identifier."); }

/** Encrypt before opening the transaction; completion means IndexedDB committed the ciphertext. */
export async function saveCheckpoint(input: {
  uid: string; journalId: string; branchId: string; localRevision: number;
  baseCloudRevision: number; masterKey: CryptoKey; plaintext: Uint8Array<ArrayBuffer>;
}): Promise<Checkpoint> {
  const { uid, journalId, branchId, localRevision, baseCloudRevision, masterKey, plaintext } = input;
  [uid, journalId, branchId].forEach(validateId);
  if (!Number.isSafeInteger(localRevision) || localRevision < 1 || !Number.isSafeInteger(baseCloudRevision) || baseCloudRevision < 0) throw new Error("Invalid checkpoint revision.");
  const encrypted = await encryptRecord(masterKey, uid, recordId(journalId, branchId), plaintext);
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("branches", "readwrite");
    const store = transaction.objectStore("branches");
    let result: Checkpoint;
    let failure: Error | undefined;
    const request = store.get([uid, journalId, branchId]);
    request.onsuccess = () => {
      const previous = request.result as Checkpoint | undefined;
      if (previous && (previous.localRevision >= localRevision || previous.baseCloudRevision !== baseCloudRevision)) {
        failure = new StaleCheckpointError(); transaction.abort(); return;
      }
      result = { uid, journalId, branchId, localRevision, baseCloudRevision,
        syncedLocalRevision: previous?.syncedLocalRevision ?? 0, updatedAt: Date.now(), encrypted };
      store.put(result);
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error("Could not save encrypted checkpoint."));
    transaction.onerror = () => { /* onabort reports the failed transaction. */ };
  });
}
export async function listCheckpoints(uid: string): Promise<Checkpoint[]> {
  validateId(uid);
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("branches", "readonly");
    const request = transaction.objectStore("branches").index("uid").getAll(uid);
    request.onsuccess = () => resolve(request.result as Checkpoint[]);
    request.onerror = () => reject(request.error ?? new Error("Could not read encrypted checkpoints."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Could not read encrypted checkpoints."));
  });
}
export function decryptCheckpoint(checkpoint: Checkpoint, masterKey: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  return decryptRecord(masterKey, checkpoint.uid, recordId(checkpoint.journalId, checkpoint.branchId), checkpoint.encrypted);
}
/** Acknowledges only an uploaded revision; newer local edits remain pending. */
export async function acknowledgeCheckpoint(uid: string, journalId: string, branchId: string, expectedBase: number, uploadedLocalRevision: number, newCloudRevision: number): Promise<void> {
  [uid, journalId, branchId].forEach(validateId);
  if (!Number.isSafeInteger(expectedBase) || expectedBase < 0 || !Number.isSafeInteger(uploadedLocalRevision) || uploadedLocalRevision < 1 || newCloudRevision !== expectedBase + 1) throw new Error("Invalid synchronization revision.");
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("branches", "readwrite");
    const store = transaction.objectStore("branches");
    let failure: Error | undefined;
    const request = store.get([uid, journalId, branchId]);
    request.onsuccess = () => {
      const current = request.result as Checkpoint | undefined;
      if (!current || current.baseCloudRevision !== expectedBase || uploadedLocalRevision > current.localRevision || uploadedLocalRevision <= current.syncedLocalRevision) {
        failure = new StaleCheckpointError(); transaction.abort(); return;
      }
      store.put({ ...current, baseCloudRevision: newCloudRevision, syncedLocalRevision: uploadedLocalRevision });
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error("Could not acknowledge encrypted checkpoint."));
    transaction.onerror = () => { /* onabort reports the failed transaction. */ };
  });
}
