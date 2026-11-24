import { photoMaxBytes } from "../ai/policy";

/** Decode locally, strip camera metadata when re-encoding, and leave room for AES and base64
 * in the existing encrypted JSON format. Small, metadata-free PNGs can keep their original bytes. */
export async function preparePhoto(file: Blob): Promise<Blob> {
  const url = URL.createObjectURL(file),
    image = new Image();
  try {
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("Invalid image.");
    const scale = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight));
    if (scale === 1 && file.size < 256 * 1024 && file.type === "image/png") {
      const bytes = new Uint8Array(await file.arrayBuffer()),
        view = new DataView(bytes.buffer);
      let clean = bytes[0] === 137 && bytes[1] === 80;
      for (let i = 8; clean && i < bytes.length;) {
        if (i + 12 > bytes.length) {
          clean = false;
          break;
        }
        const type = String.fromCharCode(...bytes.subarray(i + 4, i + 8));
        const end = i + view.getUint32(i) + 12;
        clean =
          end <= bytes.length &&
          ["IHDR", "PLTE", "tRNS", "IDAT", "IEND", "sRGB", "gAMA", "cHRM", "pHYs"].includes(type);
        if (type === "IEND" && end !== bytes.length) clean = false;
        i = end;
      }
      if (clean) return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image processing unavailable.");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.86, 0.72, 0.55]) {
      const result = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", quality),
      );
      if (result && (result.size * 4) / 3 + 2048 < photoMaxBytes) return result;
    }
    throw new Error("Photo is too large.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
