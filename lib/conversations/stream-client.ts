/** The app stream has two distinct outcomes: an explicit completion frame and an interrupted
 * connection. Only explicit completion may become a durable assistant message. */
export async function readReply(response: Response, append: (text: string) => void) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("OVI’s reply was interrupted.");
  const decoder = new TextDecoder();
  let buffer = "",
    full = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const frame = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (frame.error) throw new Error(frame.error);
        if (frame.done && full.trim()) return full;
        if (typeof frame.content === "string") {
          full += frame.content;
          append(full);
        }
      }
    }
    throw new Error("OVI’s reply was interrupted.");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
