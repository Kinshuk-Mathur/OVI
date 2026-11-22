import type { JSONContent } from "@tiptap/core";

export const JOURNAL_DRAFT_ID = "current";
export const DEFAULT_JOURNAL_TITLE = "Today, in my own words.";
const DATABASE_NAME = "ovi-journal";
const DATABASE_VERSION = 2;

export interface JournalDraft {
  id: string;
  title: string;
  entryDate: string | null;
  createdAt: number | null;
  updatedAt: number;
  content: JSONContent;
}

let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const transaction = request.transaction!;
      const drafts = database.objectStoreNames.contains("drafts") ? transaction.objectStore("drafts") : database.createObjectStore("drafts", { keyPath: "id" });
      if (!database.objectStoreNames.contains("photos")) database.createObjectStore("photos");
      // Version 1 contained one draft with no entry date or creation timestamp.
      // Preserve its key and document; its original creation date was not recorded.
      const legacyRequest = drafts.get(JOURNAL_DRAFT_ID);
      legacyRequest.onsuccess = () => {
        const draft = legacyRequest.result;
        if (!draft || ("entryDate" in draft && "createdAt" in draft)) return;
        drafts.put({ ...draft, entryDate: draft.entryDate ?? null, createdAt: draft.createdAt ?? null });
      };
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => { database.close(); databasePromise = undefined; };
      resolve(database);
    };
    request.onerror = () => reject(request.error ?? new Error("Unable to open local journal storage."));
    request.onblocked = () => reject(new Error("Local journal storage is blocked by another tab."));
  }).catch((error) => { databasePromise = undefined; throw error; });
  return databasePromise;
}

async function read<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(store, "readonly");
    const request = transaction.objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error ?? new Error("Unable to read local journal storage."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Local journal storage was interrupted."));
  });
}

async function write(store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(store, "readwrite");
    const objectStore = transaction.objectStore(store);
    if (key === undefined) objectStore.put(value); else objectStore.put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Could not save your journal locally."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save your journal locally."));
  });
}

export function getJournalDraft(id: string = JOURNAL_DRAFT_ID) { return read<JournalDraft>("drafts", id); }
export async function listJournalDrafts(): Promise<JournalDraft[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("drafts", "readonly");
    const request = transaction.objectStore("drafts").getAll();
    request.onsuccess = () => resolve(request.result as JournalDraft[]);
    request.onerror = () => reject(request.error ?? new Error("Unable to read your journal library."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Local journal storage was interrupted."));
  });
}
export async function saveJournalDraft(draft: JournalDraft) {
  await write("drafts", draft);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("ovi:journal-change"));
}
export function saveJournalPhoto(id: string, photo: Blob) { return write("photos", photo, id); }
export function getJournalPhoto(id: string) { return read<Blob>("photos", id); }
