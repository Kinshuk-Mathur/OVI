import { encryptRecord, encodeText } from "../security/vault";

/** Keep the original associated-data format: older Firestore records must decrypt after an
 * upgrade. A ciphertext copied between conversations or message IDs fails authentication. */
export const messageKey = (thread: string, id: string) => JSON.stringify(["message", thread, id]);
export const threadKey = (id: string) => JSON.stringify(["conversation", id]);
export async function encryptChatContent(key: CryptoKey, uid: string, recordKey: string, content: object) {
  const bytes = encodeText(JSON.stringify(content));
  try {
    return await encryptRecord(key, uid, recordKey, bytes);
  } finally {
    bytes.fill(0);
  }
}
