"use client";

import { doc, getDocFromServer, runTransaction, serverTimestamp, type Timestamp } from "firebase/firestore";
import type { EncryptedRecord, VaultMetadata } from "@/lib/security/vault";
import { getFirebaseServices } from "./client";

export class RevisionConflictError extends Error {
  constructor() { super("This journal changed on another device."); this.name = "RevisionConflictError"; }
}
export interface CloudJournal {
  version: 1;
  revision: number;
  encrypted: EncryptedRecord;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
function vaultRef(uid: string) { return doc(getFirebaseServices().db, "users", uid, "account", "vault"); }
function journalRef(uid: string, id: string) { return doc(getFirebaseServices().db, "users", uid, "journals", id); }

/** The server must be reachable: an absent cached document is not proof of a new vault. */
export async function loadVault(uid: string): Promise<VaultMetadata | null> {
  const snapshot = await getDocFromServer(vaultRef(uid));
  return snapshot.exists() ? snapshot.data() as VaultMetadata : null;
}
export async function createVaultOnce(uid: string, metadata: VaultMetadata, displayName = ""): Promise<void> {
  const ref = vaultRef(uid);
  const profile = doc(getFirebaseServices().db, "users", uid, "account", "profile");
  await runTransaction(getFirebaseServices().db, async (transaction) => {
    const currentVault = await transaction.get(ref);
    const currentProfile = await transaction.get(profile);
    if (currentVault.exists()) throw new Error("A vault already exists for this account.");
    transaction.set(ref, metadata);
    if (!currentProfile.exists()) transaction.set(profile, { uid, displayName: displayName.slice(0, 160), createdAt: serverTimestamp(), preferences: {}, vaultInitialized: true });
  });
}
export async function updateVaultAfterRecovery(uid: string, metadata: VaultMetadata, expectedRevision: number): Promise<void> {
  const ref = vaultRef(uid);
  await runTransaction(getFirebaseServices().db, async (transaction) => {
    const current = await transaction.get(ref);
    if (!current.exists() || current.data().revision !== expectedRevision || metadata.revision !== expectedRevision + 1) throw new RevisionConflictError();
    transaction.set(ref, metadata);
  });
}
/** Caller must keep its encrypted local branch when this rejects or conflicts. */
export async function writeJournalRevision(uid: string, id: string, encrypted: EncryptedRecord, expectedRevision: number): Promise<number> {
  const ref = journalRef(uid, id);
  return runTransaction(getFirebaseServices().db, async (transaction) => {
    const current = await transaction.get(ref);
    const currentRevision = current.exists() ? current.data().revision : 0;
    if (currentRevision !== expectedRevision) throw new RevisionConflictError();
    const revision = currentRevision + 1;
    transaction.set(ref, { version: 1, revision, encrypted, createdAt: current.exists() ? current.data().createdAt : serverTimestamp(), updatedAt: serverTimestamp() });
    return revision;
  });
}
