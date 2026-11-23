"use client";

import { collection, doc, serverTimestamp, setDoc, type Timestamp } from "firebase/firestore";
import { encodeText, encryptRecord, type EncryptedRecord } from "@/lib/security/vault";
import { getFirebaseServices } from "./client";

export interface ConversationContent { title?: string; journalContextId?: string }
export interface MessageContent { role: "user" | "assistant"; text: string; journalContextId?: string }
export interface EncryptedChatRecord { version: 1; encrypted: EncryptedRecord; createdAt: Timestamp }
export async function createConversation(uid: string, key: CryptoKey, content: ConversationContent): Promise<string> {
  const reference = doc(collection(getFirebaseServices().db, "users", uid, "conversations"));
  const bytes = encodeText(JSON.stringify(content));
  try {
    const encrypted = await encryptRecord(key, uid, JSON.stringify(["conversation", reference.id]), bytes);
    await setDoc(reference, { version: 1, encrypted, createdAt: serverTimestamp() });
    return reference.id;
  } finally { bytes.fill(0); }
}
export async function addConversationMessage(uid: string, key: CryptoKey, conversationId: string, content: MessageContent): Promise<string> {
  const reference = doc(collection(getFirebaseServices().db, "users", uid, "conversations", conversationId, "messages"));
  const bytes = encodeText(JSON.stringify(content));
  try {
    const encrypted = await encryptRecord(key, uid, JSON.stringify(["message", conversationId, reference.id]), bytes);
    await setDoc(reference, { version: 1, encrypted, createdAt: serverTimestamp() });
    return reference.id;
  } finally { bytes.fill(0); }
}
