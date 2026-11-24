/** Only explicitly public failures cross the API boundary. Provider bodies may contain private text. */
export class PublicError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAt?: number,
    readonly code = "unavailable",
  ) {
    super(message);
  }
}
export const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export function failure(error: unknown) {
  const safe =
    error instanceof PublicError
      ? error
      : new PublicError(503, "OVI is temporarily unavailable. Please try again later.");
  const headers = new Headers(privateHeaders);
  if (safe.retryAt)
    headers.set("Retry-After", String(Math.max(1, Math.ceil((safe.retryAt - Date.now()) / 1000))));
  return Response.json(
    { error: safe.message, code: safe.code, retryAt: safe.retryAt },
    { status: safe.status, headers },
  );
}
export function invalid(message = "This request could not be read.") {
  return new PublicError(400, message, undefined, "invalid");
}

/** Limit the actual stream, including chunked bodies without a Content-Length header. */
export async function readBytes(request: Request, max: number, type: string): Promise<Buffer> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== type)
    throw new PublicError(415, "Unsupported file or request format.");
  const tooLarge = () => new PublicError(413, "This request is too large.");
  if (Number(request.headers.get("content-length")) > max) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw invalid();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    reader.releaseLock();
  }
}
export async function readJson(request: Request, max = 2048) {
  const bytes = await readBytes(request, max, "application/json");
  try {
    const value = JSON.parse(bytes.toString());
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
    return value as Record<string, unknown>;
  } catch {
    throw invalid();
  }
}
