/** A single canonical PCM format makes quota accounting independent of browser duration claims
 * and container metadata. Every two payload bytes represent one 16 kHz mono sample. */
export const sampleRate = 16000,
  maxSeconds = 120,
  maxWavBytes = 44 + 2 * sampleRate * maxSeconds;
export function wavDuration(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (
    bytes.length < 44 + 320 ||
    bytes.length > maxWavBytes ||
    bytes.length % 2 ||
    tag(0) !== "RIFF" ||
    view.getUint32(4, true) !== bytes.length - 8 ||
    tag(8) !== "WAVE" ||
    tag(12) !== "fmt " ||
    view.getUint32(16, true) !== 16 ||
    view.getUint16(20, true) !== 1 ||
    view.getUint16(22, true) !== 1 ||
    view.getUint32(24, true) !== sampleRate ||
    view.getUint32(28, true) !== sampleRate * 2 ||
    view.getUint16(32, true) !== 2 ||
    view.getUint16(34, true) !== 16 ||
    tag(36) !== "data" ||
    view.getUint32(40, true) !== bytes.length - 44
  )
    return 0;
  return Math.ceil((bytes.length - 44) / (2 * sampleRate));
}
export function makeWav(chunks: Float32Array[], length: number) {
  const size = Math.min(length, maxSeconds * sampleRate);
  const bytes = new Uint8Array(44 + 2 * size),
    view = new DataView(bytes.buffer);
  const tag = (at: number, s: string) => bytes.set(new TextEncoder().encode(s), at);
  tag(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, size * 2, true);
  let index = 0;
  for (const chunk of chunks)
    for (const s of chunk) {
      if (index >= size) break;
      view.setInt16(44 + 2 * index++, Math.max(-1, Math.min(1, s)) * (s < 0 ? 32768 : 32767), true);
    }
  return new Blob([bytes], { type: "audio/wav" });
}
