import { parseUsage } from "./provider";
import type { Usage } from "../server/quota";

/** Groq SSE can split a JSON line or a Hindi codepoint across network chunks. Decode incrementally
 * and forward only choice.delta.content. A truncated connection never becomes a completed reply. */
export async function consumeGroq(
  stream: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
  onUsage: (usage: Usage) => void,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    ended = false,
    finished = false,
    visible = false;
  try {
    while (!ended) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trimEnd();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") {
          ended = true;
          break;
        }
        const event = JSON.parse(data),
          choice = event.choices?.[0];
        if (event.error) throw new Error("Provider interrupted");
        const usage = parseUsage(event.usage ?? event.x_groq?.usage);
        if (usage) onUsage(usage);
        if (choice?.finish_reason === "stop") finished = true;
        if (typeof choice?.delta?.content === "string" && choice.delta.content) {
          visible = true;
          onText(choice.delta.content);
        }
      }
    }
    if (!ended || !visible || !finished) throw new Error("Incomplete reply");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
