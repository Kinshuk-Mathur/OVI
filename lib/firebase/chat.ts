"use client";

import { collection, doc, serverTimestamp, setDoc, type Timestamp } from "firebase/firestore";
import { encryptChatContent, messageKey, threadKey } from "../conversations/envelope";
import type { EncryptedRecord } from "@/lib/security/vault";
import { getFirebaseServices } from "./client";

export interface ConversationContent { title?: string; journalContextId?: string }
export interface MessageContent { role: "user" | "assistant"; text: string; journalContextId?: string }
export interface EncryptedChatRecord { version: 1; encrypted: EncryptedRecord; createdAt: Timestamp }
export async function createConversation(uid: string, key: CryptoKey, content: ConversationContent): Promise<string> {
  const reference = doc(collection(getFirebaseServices().db, "users", uid, "conversations"));
  const encrypted = await encryptChatContent(key,uid,threadKey(reference.id),content);
  await setDoc(reference, { version: 1, encrypted, createdAt: serverTimestamp() });
  return reference.id;
}
export async function addConversationMessage(uid: string, key: CryptoKey, conversationId: string, content: MessageContent): Promise<string> {
  const reference = doc(collection(getFirebaseServices().db, "users", uid, "conversations", conversationId, "messages"));
  const encrypted = await encryptChatContent(key,uid,messageKey(conversationId,reference.id),content);
  await setDoc(reference, { version: 1, encrypted, createdAt: serverTimestamp() });
  return reference.id;
}
