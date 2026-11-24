/** These beta product limits are independent of the account's Groq organization limits. */
export function integer(name: string, fallback: number, max = 1_000_000_000) {
  const raw = process.env[name];
  const n = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new Error("Invalid OVI limit configuration");
  return n;
}
export function policy() {
  return {
    dailyChat: integer("OVI_CHAT_DAILY", 30),
    burst: integer("OVI_CHAT_BURST", 3),
    voiceSeconds: integer("OVI_VOICE_DAILY_SECONDS", 600),
    dailyPhotos: integer("OVI_PHOTOS_DAILY", 20),
    journalPhotos: integer("OVI_PHOTOS_PER_JOURNAL", 20),
    storageBytes: integer("OVI_PHOTO_STORAGE_BYTES", 250 * 1024 * 1024),
  };
}
export const photoMaxBytes = 5 * 1024 * 1024;
export const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);
export const resetAt = (now: number) => Date.parse(dayOf(now)) + 86_400_000;
