/** Groq’s wire protocol stays here. The browser consumes OVI frames and never sees credentials, reasoning or upstream errors. */
import type { ModelMessage } from "./context";
import type { Usage } from "../server/quota";
import { providerBusy } from "../server/quota";
import { PublicError } from "../server/http";
export interface Generation {
  messages: ModelMessage[];
  maxOutput: number;
  model: string;
  signal: AbortSignal;
}
export interface ChatProvider {
  stream(input: Generation): Promise<ReadableStream<Uint8Array>>;
}
export function model(kind: "chat" | "voice") {
  const approved = kind === "chat" ? "openai/gpt-oss-120b" : "whisper-large-v3-turbo";
  const setting = kind === "chat" ? process.env.OVI_CHAT_MODEL : process.env.OVI_STT_MODEL;
  if (setting && setting !== approved) throw new Error("Unsupported OVI model configuration");
  if (!process.env.GROQ_API_KEY) throw new PublicError(503, "OVI’s server is missing its Groq API key.", undefined, "provider_config");
  return approved;
}
export class UpstreamRejection extends PublicError {}
async function groq(endpoint: string, init: RequestInit) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${process.env.GROQ_API_KEY}`);
  const response = await fetch(`https://api.groq.com/openai/v1/${endpoint}`, {
    ...init,
    headers,
    cache: "no-store",
    redirect: "error",
  });
  if (response.ok) return response;
  await response.body?.cancel();
  const retry = response.headers.get("retry-after");
  const delay =
    retry && /^\d+(\.\d+)?$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry ?? "");
  const error =
    response.status === 429
      ? providerBusy(Number.isFinite(delay) ? delay : Date.now() + 60000)
      : response.status === 401 || response.status === 403
        ? new PublicError(503, "Groq rejected OVI’s server credentials or model access.", undefined, "provider_config")
        : new PublicError(503, "OVI couldn’t reach its AI service. Please try again later.");
  // 5xx may follow processing. Treat only definite 4xx rejection as refundable.
  if (response.status >= 500) throw error;
  throw new UpstreamRejection(error.status, error.message, error.retryAt, error.code);
}
export const groqProvider: ChatProvider = {
  async stream({ messages, maxOutput, model, signal }) {
    const response = await groq("chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model,
        messages,
        max_completion_tokens: maxOutput,
        reasoning_effort: "low",
        include_reasoning: false,
        stream: true,
      }),
    });
    if (!response.body) throw new Error("Missing provider stream");
    return response.body;
  },
};
export async function transcribe(wav: Blob, model: string, signal: AbortSignal) {
  const form = new FormData();
  form.set("model", model);
  form.set("file", wav, "recording.wav");
  form.set("response_format", "json");
  // Keep automatic language detection. This transcription hint helps Whisper preserve a
  // mid-sentence language switch without sending any prior journal or conversation text.
  form.set(
    "prompt",
    "Verbatim multilingual conversation in English, हिंदी and Hinglish. Keep English words in English and Hindi words in Hindi, including when the speaker switches languages.",
  );
  const data = await (await groq("audio/transcriptions", { method: "POST", body: form, signal })).json();
  if (typeof data.text !== "string" || !data.text.trim())
    throw new PublicError(422, "No clear speech was recognized. Try recording again.");
  return data.text.trim() as string;
}
export function parseUsage(raw: Record<string, any> | undefined): Usage | undefined {
  if (!raw) return;
  const { prompt_tokens: input, completion_tokens: output } = raw,
    cached = raw.prompt_tokens_details?.cached_tokens;
  if (![input, output].every((n) => Number.isSafeInteger(n) && n >= 0)) return;
  return {
    input,
    output,
    ...(Number.isSafeInteger(cached) && cached >= 0 && cached <= input ? { cached } : {}),
  };
}
