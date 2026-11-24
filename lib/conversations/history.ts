"use client";
import { getDocs, limit, orderBy, query, startAfter } from "firebase/firestore";
import { decodeText, decryptRecord } from "../security/vault";
import { threadKey } from "./envelope";
import { firstTurnSummary, pendingMessages, pendingThreads, threads, type PageCursor } from "./repository";

export interface HistoryEntry {
  id: string;
  title: string;
  at: number;
}
const pageSize = 24;

/** Fetch headers only. Older headers did not contain a title, but their creation time
 * and message collection are still available and can be opened without migration. */
export async function historyPage(uid: string, key: CryptoKey, cursor?: PageCursor) {
  const after = cursor ? [startAfter(cursor)] : [];
  const snapshot = await getDocs(query(threads(uid), orderBy("createdAt", "desc"), ...after, limit(pageSize)));
  const entries = await Promise.all(snapshot.docs.map(async (doc) => {
    const bytes = await decryptRecord(key, uid, threadKey(doc.id), doc.get("encrypted"));
    try {
      const { title } = JSON.parse(decodeText(bytes));
      return { id: doc.id, title: typeof title === "string" && title.trim() ? title : "Conversation", at: doc.get("createdAt").toMillis() };
    } finally {
      bytes.fill(0);
    }
  }));
  return { entries, next: snapshot.size === pageSize ? snapshot.docs.at(-1) : undefined };
}

/** A first message can be safely on this device before its Firestore header exists. */
export async function pendingHistory(uid: string, key: CryptoKey): Promise<HistoryEntry[]> {
  const ids = await pendingThreads(uid);
  const entries = await Promise.all(ids.map(async (id) => {
    const summary = firstTurnSummary(await pendingMessages(uid, key, id));
    return summary && { id, ...summary };
  }));
  return entries.filter((row): row is HistoryEntry => Boolean(row));
}

/** Synced headers supply the canonical creation date when the same thread is in both stores. */
export function groupHistory(local: HistoryEntry[], synced: HistoryEntry[]) {
  const unique = new Map([...local, ...synced].map((entry) => [entry.id, entry]));
  const sorted = [...unique.values()].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: "full" });
  const groups = new Map<string, HistoryEntry[]>();
  for (const entry of sorted) {
    const day = date.format(entry.at);
    const group = groups.get(day);
    if (group) group.push(entry);
    else groups.set(day, [entry]);
  }
  return groups;
}
