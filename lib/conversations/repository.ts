"use client";
/** Client-side conversation storage. IndexedDB protects unsent ciphertext and Firestore synchronizes immutable turns across devices. */
import { openDB, type DBSchema } from "idb";
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { getFirebaseServices } from "../firebase/client";
import { decodeText, decryptRecord, type EncryptedRecord } from "../security/vault";

import { encryptChatContent, messageKey, threadKey } from "./envelope";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  pending?: boolean;
}
interface Envelope {
  uid: string;
  conversation: string;
  id: string;
  encrypted: EncryptedRecord;
}
interface Outbox extends DBSchema {
  messages: { key: [string, string, string]; value: Envelope; indexes: { thread: [string, string] } };
}
const local = () =>
  openDB<Outbox>("ovi-chat-outbox", 1, {
    upgrade(db) {
      db.createObjectStore("messages", { keyPath: ["uid", "conversation", "id"] }).createIndex("thread", [
        "uid",
        "conversation",
      ]);
    },
  });
export const threads = (uid: string) => collection(getFirebaseServices().db, "users", uid, "conversations");
const messages = (uid: string, thread: string) => collection(threads(uid), thread, "messages");
export type PageCursor = QueryDocumentSnapshot;
/** Walk distinct thread keys for this account, including chats created while offline.
 * The compound-key range excludes other accounts without decrypting any of their records. */
export async function pendingThreads(uid: string) {
  const db = await local();
  try {
    const index = db.transaction("messages").store.index("thread");
    const range = IDBKeyRange.bound([uid], [uid, []]);
    const ids: string[] = [];
    let cursor = await index.openKeyCursor(range, "nextunique");
    while (cursor) {
      ids.push(cursor.key[1]);
      cursor = await cursor.continue();
    }
    return ids;
  } finally {
    db.close();
  }
}

export async function checkpointMessage(
  uid: string,
  key: CryptoKey,
  conversation: string,
  message: ChatMessage,
) {
  const encrypted = await encryptChatContent(key, uid, messageKey(conversation, message.id), {
    role: message.role,
    text: message.text,
    at: message.at,
  });
  const db = await local();
  try {
    await db.put("messages", { uid, conversation, id: message.id, encrypted });
  } finally {
    db.close();
  }
}
async function decode(
  uid: string,
  key: CryptoKey,
  thread: string,
  id: string,
  encrypted: EncryptedRecord,
  fallback: number,
): Promise<ChatMessage> {
  const bytes = await decryptRecord(key, uid, messageKey(thread, id), encrypted);
  try {
    const data = JSON.parse(decodeText(bytes));
    if (typeof data.text !== "string" || !["user", "assistant"].includes(data.role))
      throw new Error("Invalid message.");
    return { id, role: data.role, text: data.text, at: Number.isFinite(data.at) ? data.at : fallback };
  } finally {
    bytes.fill(0);
  }
}
async function pending(uid: string, thread: string) {
  const db = await local();
  try {
    return await db.getAllFromIndex("messages", "thread", [uid, thread]);
  } finally {
    db.close();
  }
}
export async function pendingMessages(uid: string, key: CryptoKey, thread: string) {
  return Promise.all(
    (await pending(uid, thread)).map(async (r) => ({
      ...(await decode(uid, key, thread, r.id, r.encrypted, 0)),
      pending: true,
    })),
  );
}
/** A short excerpt makes the history recognizable. Persist it only inside the vault envelope. */
export function firstTurnSummary(rows: ChatMessage[]) {
  const ordered = [...rows].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const first = ordered.find((row) => row.role === "user") ?? ordered[0];
  return first && { title: Array.from(first.text.trim().replace(/\s+/g, " ")).slice(0, 64).join(""), at: first.at };
}
/** Exactly one immutable Firestore record per local ID. A network failure keeps ciphertext in
 * IndexedDB. Replaying an acknowledged write only clears that outbox item; it never calls Groq. */
export async function syncOutbox(uid: string, key: CryptoKey, thread: string) {
  const rows = await pending(uid, thread);
  if (!rows.length) return;
  const parent = doc(threads(uid), thread);
  let header: EncryptedRecord | undefined;
  for (const row of rows) {
    const ref = doc(messages(uid, thread), row.id);
    await runTransaction(getFirebaseServices().db, async (tx) => {
      const root = await tx.get(parent),
        existing = await tx.get(ref);
      if (!root.exists()) {
        // Outbox IDs are random. Use message time to find the opening turn after an offline replay.
        if (!header) {
          const turns = await Promise.all(rows.map((r) => decode(uid, key, thread, r.id, r.encrypted, 0)));
          header = await encryptChatContent(key, uid, threadKey(thread), { title: firstTurnSummary(turns)?.title });
        }
        tx.set(parent, { version: 1, encrypted: header, createdAt: serverTimestamp() });
      }
      if (!existing.exists())
        tx.set(ref, { version: 1, encrypted: row.encrypted, createdAt: serverTimestamp() });
      else if (existing.data().encrypted?.payload?.ciphertext !== row.encrypted.payload.ciphertext)
        throw new Error("Message identifier collision.");
    });
    const db = await local();
    try {
      await db.delete("messages", [uid, thread, row.id]);
    } finally {
      db.close();
    }
  }
}
const pageSize = 32;
async function readPage(uid: string, key: CryptoKey, thread: string, docs: QueryDocumentSnapshot[]) {
  const rows = await Promise.all(
    docs.map((d) =>
      decode(uid, key, thread, d.id, d.get("encrypted"), d.get("createdAt")?.toMillis() ?? Date.now()),
    ),
  );
  return { rows, cursor: docs.at(-1), more: docs.length === pageSize };
}
export function watchMessages(
  uid: string,
  key: CryptoKey,
  thread: string,
  receive: (page: Awaited<ReturnType<typeof readPage>>) => void,
  fail: () => void,
) {
  let version = 0;
  const unsubscribe = onSnapshot(
    query(messages(uid, thread), orderBy("createdAt", "desc"), limit(pageSize)),
    (snap) => {
      const v = ++version;
      void readPage(uid, key, thread, snap.docs)
        .then((page) => {
          if (v === version) receive(page);
        })
        .catch(fail);
    },
    fail,
  );
  return () => {
    version++;
    unsubscribe();
  };
}
export async function earlierMessages(uid: string, key: CryptoKey, thread: string, cursor: PageCursor) {
  const result = await getDocs(
    query(messages(uid, thread), orderBy("createdAt", "desc"), startAfter(cursor), limit(pageSize)),
  );
  return readPage(uid, key, thread, result.docs);
}
