/** Coordinate media availability and deletion with revisioned journal autosave without exposing journal text to the server. */
import type { JSONContent } from "@tiptap/core";
import { openDB } from "idb";
import { doc, getDocFromServer } from "firebase/firestore";
import { getFirebaseServices } from "../firebase/client";
import { api, ApiError, jsonPost } from "../firebase/api-client";
import { decodeText, decryptRecord } from "../security/vault";
import type { JournalDraft } from "../journal-storage";
import { uploadPendingPhotos } from "./media";

export function mediaIds(node: JSONContent, journalId: string): string[] {
  const found = new Set<string>();
  function visit(n: JSONContent) {
    if (n.type === "journalImage") {
      if (n.attrs?.journalId !== journalId || typeof n.attrs.imageId !== "string")
        throw new Error("Invalid journal image.");
      found.add(n.attrs.imageId);
    }
    n.content?.forEach(visit);
  }
  visit(node);
  return [...found];
}
/** When an image quota is full, keep its ciphertext and full editor document locally. Ship the
 * same text to the cloud with only available photo references. Other devices never see broken photos. */
export async function prepareCloudDraft(
  uid: string,
  draft: JournalDraft,
  available: Set<string>,
  key: CryptoKey,
) {
  const blocked = new Set<string>();
  let notice = "";
  for (const id of mediaIds(draft.content, draft.id)) {
    if (available.has(id)) continue;
    try {
      await uploadPendingPhotos(uid, draft.id, [id], key);
    } catch (err) {
      if (!(err instanceof ApiError) || !["photo_daily", "photo_storage", "photo_count"].includes(err.code))
        throw err;
      blocked.add(id);
      notice = err.message;
    }
  }
  if (!blocked.size) return { draft, notice };
  function omitPending(node: JSONContent): JSONContent {
    return node.content
      ? {
          ...node,
          content: node.content
            .filter((n) => n.type !== "journalImage" || !blocked.has(n.attrs?.imageId))
            .map(omitPending),
        }
      : node;
  }
  return { draft: { ...draft, content: omitPending(draft.content) }, notice };
}
interface Removal {
  uid: string;
  journalId: string;
  mediaId: string;
  afterRevision: number;
}
const queue = () =>
  openDB("ovi-photo-removals", 1, {
    upgrade(db) {
      db.createObjectStore("removals", { keyPath: ["uid", "journalId", "mediaId"] }).createIndex(
        "uid",
        "uid",
      );
    },
  });
/** Persist intent before publishing the journal revision. A failed or conflicting save cannot
 * delete a referenced object: cleanup reopens the latest committed, encrypted journal first. */
export async function queueRemovals(uid: string, journalId: string, ids: string[], afterRevision: number) {
  if (!ids.length) return;
  const db = await queue();
  try {
    const tx = db.transaction("removals", "readwrite");
    for (const mediaId of ids) await tx.store.put({ uid, journalId, mediaId, afterRevision });
    await tx.done;
  } finally {
    db.close();
  }
}
export async function drainRemovals(uid: string, key: CryptoKey) {
  const db = await queue();
  try {
    const rows: Removal[] = await db.getAllFromIndex("removals", "uid", uid);
    for (const row of rows) {
      const snap = await getDocFromServer(
          doc(getFirebaseServices().db, "users", uid, "journals", row.journalId),
        ),
        data = snap.data();
      if (!data || data.revision < row.afterRevision) continue;
      const bytes = await decryptRecord(key, uid, JSON.stringify(["journal", row.journalId]), data.encrypted);
      try {
        const ids = mediaIds(JSON.parse(decodeText(bytes)).content, row.journalId);
        if (!ids.includes(row.mediaId))
          await api(
            "/api/media/remove",
            jsonPost({ journalId: row.journalId, mediaId: row.mediaId, revision: data.revision }),
          );
        await db.delete("removals", [uid, row.journalId, row.mediaId]);
      } finally {
        bytes.fill(0);
      }
    }
  } finally {
    db.close();
  }
}
