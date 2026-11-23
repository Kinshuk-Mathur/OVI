/** Versioned, client-side vault primitives. Secret material is never persisted here. */
import { argon2idAsync } from "@noble/hashes/argon2";

export interface SealedBytes { iv: string; ciphertext: string }
export interface VaultMetadata {
  version: 1;
  revision: number;
  kdf: { name: "argon2id"; salt: string; memoryKiB: number; iterations: number; parallelism: number };
  passwordWrappedKey: SealedBytes;
  recoveryWrappedKey: SealedBytes;
}
export interface EncryptedRecord { version: 1; wrappedKey: SealedBytes; payload: SealedBytes }

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));
function encode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid encrypted data.");
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
const aad = (purpose: string, uid: string, id = "") => encoder.encode(JSON.stringify(["ovi", 1, purpose, uid, id]));
async function importAes(raw: Uint8Array<ArrayBuffer>, extractable = false): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", extractable, ["encrypt", "decrypt"]);
}
async function seal(key: CryptoKey, plaintext: Uint8Array<ArrayBuffer>, additionalData: Uint8Array<ArrayBuffer>): Promise<SealedBytes> {
  const iv = random(12);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData }, key, plaintext);
  return { iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
}
async function open(key: CryptoKey, sealed: SealedBytes, additionalData: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const iv = decode(sealed.iv);
  if (iv.length !== 12) throw new Error("Invalid encrypted data.");
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData }, key, decode(sealed.ciphertext)));
}
async function passwordKey(password: string, kdf: VaultMetadata["kdf"]): Promise<CryptoKey> {
  // Reject hostile or unsupported parameters before allocating memory.
  if (kdf.name !== "argon2id" || kdf.memoryKiB !== 65536 || kdf.iterations !== 3 || kdf.parallelism !== 1) throw new Error("Unsupported vault format.");
  const salt = decode(kdf.salt);
  if (salt.length !== 16) throw new Error("Invalid vault metadata.");
  const derived = await argon2idAsync(encoder.encode(password), salt, { m: kdf.memoryKiB, t: kdf.iterations, p: kdf.parallelism, dkLen: 32, asyncTick: 10 });
  const material = Uint8Array.from(derived);
  try { return await importAes(material); } finally { derived.fill(0); material.fill(0); }
}
function validatePassword(password: string) {
  if (password.length < 12 || password.length > 1024) throw new Error("Use a password between 12 and 1024 characters.");
}
export async function createVault(uid: string, password: string): Promise<{ metadata: VaultMetadata; recoveryKey: string; masterKey: CryptoKey }> {
  validatePassword(password);
  const kdf: VaultMetadata["kdf"] = { name: "argon2id", salt: encode(random(16)), memoryKiB: 65536, iterations: 3, parallelism: 1 };
  const master = random(32), recovery = random(32);
  try {
    const passwordWrappingKey = await passwordKey(password, kdf);
    const recoveryWrappingKey = await importAes(recovery);
    const metadata: VaultMetadata = { version: 1, revision: 1, kdf,
      passwordWrappedKey: await seal(passwordWrappingKey, master, aad("password", uid)),
      recoveryWrappedKey: await seal(recoveryWrappingKey, master, aad("recovery", uid)) };
    return { metadata, recoveryKey: encode(recovery), masterKey: await importAes(master) };
  } finally { master.fill(0); recovery.fill(0); }
}
export async function unlockVault(uid: string, password: string, metadata: VaultMetadata): Promise<CryptoKey> {
  if (metadata.version !== 1) throw new Error("Unsupported vault format.");
  const bytes = await open(await passwordKey(password, metadata.kdf), metadata.passwordWrappedKey, aad("password", uid));
  try { if (bytes.length !== 32) throw new Error("Invalid vault key."); return await importAes(bytes); } finally { bytes.fill(0); }
}
export async function recoverVault(uid: string, recoveryKey: string, newPassword: string, metadata: VaultMetadata): Promise<{ metadata: VaultMetadata; masterKey: CryptoKey }> {
  validatePassword(newPassword);
  if (metadata.version !== 1) throw new Error("Unsupported vault format.");
  const recovery = decode(recoveryKey.trim());
  if (recovery.length !== 32) throw new Error("Invalid recovery key.");
  let master: Uint8Array<ArrayBuffer> | undefined;
  try {
    master = await open(await importAes(recovery), metadata.recoveryWrappedKey, aad("recovery", uid));
    if (master.length !== 32) throw new Error("Invalid vault key.");
    const kdf: VaultMetadata["kdf"] = { name: "argon2id", salt: encode(random(16)), memoryKiB: 65536, iterations: 3, parallelism: 1 };
    const passwordWrappedKey = await seal(await passwordKey(newPassword, kdf), master, aad("password", uid));
    return { metadata: { ...metadata, revision: metadata.revision + 1, kdf, passwordWrappedKey }, masterKey: await importAes(master) };
  } finally { recovery.fill(0); master?.fill(0); }
}
export async function encryptRecord(masterKey: CryptoKey, uid: string, id: string, plaintext: Uint8Array<ArrayBuffer>): Promise<EncryptedRecord> {
  const raw = random(32);
  try {
    const recordKey = await importAes(raw);
    return { version: 1, wrappedKey: await seal(masterKey, raw, aad("record-key", uid, id)), payload: await seal(recordKey, plaintext, aad("record", uid, id)) };
  } finally { raw.fill(0); }
}
export async function decryptRecord(masterKey: CryptoKey, uid: string, id: string, record: EncryptedRecord): Promise<Uint8Array<ArrayBuffer>> {
  if (record.version !== 1) throw new Error("Unsupported record format.");
  const raw = await open(masterKey, record.wrappedKey, aad("record-key", uid, id));
  try { if (raw.length !== 32) throw new Error("Invalid record key."); return await open(await importAes(raw), record.payload, aad("record", uid, id)); } finally { raw.fill(0); }
}
export const encodeText = (value: string) => encoder.encode(value);
export const decodeText = (value: Uint8Array) => decoder.decode(value);
