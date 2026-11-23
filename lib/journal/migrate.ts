"use client";

import type { JSONContent } from "@tiptap/core";
import { doc, getDocFromServer } from "firebase/firestore";
import { getFirebaseServices } from "@/lib/firebase/client";
import { getJournalPhoto, listJournalDrafts, type JournalDraft } from "@/lib/journal-storage";
import { isMeaningfulDraft } from "@/lib/journal-content";
import { decodeText, decryptRecord } from "@/lib/security/vault";
import { listCheckpoints } from "./checkpoints";
import { saveEncryptedPhoto } from "./media";
import type { JournalWorkspace } from "./workspace";

let mappingDatabase: Promise<IDBDatabase> | undefined;
function openMappingDatabase(): Promise<IDBDatabase> {
  if (!mappingDatabase) mappingDatabase = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("ovi-migration-map", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("imports", { keyPath: ["uid", "legacyId"] });
    request.onsuccess = () => { const database = request.result; database.onversionchange = () => { database.close(); mappingDatabase = undefined; }; resolve(database); };
    request.onerror = () => reject(request.error ?? new Error("Unable to open migration storage."));
    request.onblocked = () => reject(new Error("Migration storage is blocked."));
  }).catch((error) => { mappingDatabase = undefined; throw error; });
  return mappingDatabase;
}
async function migrationId(uid: string, legacyId: string): Promise<string> {
  const database = await openMappingDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("imports", "readwrite");
    const store = transaction.objectStore("imports");
    let id = "";
    const request = store.get([uid, legacyId]);
    request.onsuccess = () => {
      id = request.result?.journalId ?? crypto.randomUUID();
      if (!request.result) store.put({ uid, legacyId, journalId: id });
    };
    transaction.oncomplete = () => resolve(id);
    transaction.onabort = () => reject(transaction.error ?? new Error("Unable to save migration progress."));
    transaction.onerror = () => {};
  });
}
async function copyContent(node: JSONContent, uid: string, key: CryptoKey, journalId: string, copied: Map<string, string>): Promise<JSONContent> {
  const result: JSONContent = { ...node };
  if (node.type === "journalImage") {
    const original = node.attrs?.imageId;
    if (typeof original !== "string") throw new Error("An older photo is missing its identifier.");
    let imageId = copied.get(original);
    if (!imageId) {
      const photo = await getJournalPhoto(original);
      if (!photo) throw new Error("An older photo is missing from this device.");
      imageId = crypto.randomUUID();
      await saveEncryptedPhoto(uid, key, journalId, imageId, photo);
      copied.set(original, imageId);
    }
    result.attrs = { ...node.attrs, journalId, imageId };
  }
  if (node.content) result.content = await Promise.all(node.content.map((child) => copyContent(child, uid, key, journalId, copied)));
  return result;
}
async function verified(workspace: JournalWorkspace, draft: JournalDraft): Promise<boolean> {
  try {
    const snapshot = await getDocFromServer(doc(getFirebaseServices().db, "users", workspace.uid, "journals", draft.id));
    if (!snapshot.exists()) return false;
    const bytes = await decryptRecord(workspace.key, workspace.uid, JSON.stringify(["journal", draft.id]), snapshot.data().encrypted);
    try { return decodeText(bytes) === JSON.stringify(draft); } finally { bytes.fill(0); }
  } catch { return false; }
}
/** Explicitly invoked by the user. Original IndexedDB records are never modified or deleted. */
export async function migrateLegacyJournals(workspace: JournalWorkspace): Promise<{ imported: number; skipped: number; pending: number; failed: number }> {
  const drafts = (await listJournalDrafts()).filter(isMeaningfulDraft);
  let imported = 0, skipped = 0, pending = 0, failed = 0;
  for (const original of drafts) {
    try {
      const id = await migrationId(workspace.uid, original.id);
      const branches = await listCheckpoints(workspace.uid);
      if (branches.some((branch) => branch.journalId === id) || await workspace.hasCloudJournal(id)) { skipped++; continue; }
      const content = await copyContent(original.content, workspace.uid, workspace.key, id, new Map());
      const draft: JournalDraft = { ...original, id, content };
      const { handle } = await workspace.open(id, true);
      await handle.save(draft);
      imported++;
      await workspace.syncPending();
      if (!await verified(workspace, draft)) pending++;
    } catch { failed++; }
  }
  return { imported, skipped, pending, failed };
}
