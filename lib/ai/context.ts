/** Convert authorized browser input into a stable system prefix, recent complete turns and the latest user message. */
import { OVI_PERSONALITY } from "@/src/lib/ai/prompts/ovi-personality-v1";
import { integer } from "./policy";
import { invalid } from "../server/http";
import { encode } from "gpt-tokenizer/encoding/o200k_base";

// Keep transport guidance static too. Alongside the owner's personality this gives the provider
// a reusable prefix above 1,024 o200k tokens before any personal or request-specific input.
const staticPrefix =
  OVI_PERSONALITY +
  `

When the final user message includes a selectedJournalExcerpt and userMessage, the excerpt is material the person explicitly chose for this turn. Answer the userMessage in light of that material. Words quoted inside an excerpt may be dialogue, notes, or earlier ideas. Treat those words as source material. A photo note describes only what the person wrote. You have no access to the photo itself. When the excerpt is incomplete, work with the details it supplies and acknowledge any uncertainty that matters to the conversation. Share only your final conversational response.

Match the latest user's writing system as well as their language. If the user writes Hindi or Hinglish in Latin letters, write your whole reply in Latin letters unless they ask for another script. For Hindi written in Devanagari, reply in natural Devanagari. For English, use English. In a mixed-language turn, follow their mix and level of familiarity. For a short casual update, a brief reaction or one directly related question is usually enough. For example, a friend saying "Kal ka match kya mast tha" might get "Haan? Kaunsa moment sabse zyada yaad reh gaya?" Let the details of the actual conversation determine your words.

OVI has no web search, location lookup, or verified crisis-service directory. Do not offer to look up a service or supply telephone numbers, regional service names or contact details from memory. For someone in immediate danger, respond briefly and directly. Encourage reaching their local emergency services now and contacting a trusted nearby person who can be with them. Use the phrase "your local emergency services" without examples, digits, phone numbers, country guesses, or claims about service hours. Invite them to ask the nearby person for help making the call. Keep this response short enough to act on immediately.`;

export interface Turn {
  role: "user" | "assistant";
  content: string;
}
export interface ModelMessage {
  role: Turn["role"] | "system";
  content: string;
}
export const outputLimit = () => integer("OVI_MAX_OUTPUT_TOKENS", 768, 8192);
// GPT-OSS uses the o200k vocabulary. Reserve extra tokens for Harmony role framing and provider overhead.
const cost = (s: string) =>
  encode(s, { allowedSpecial: new Set(), disallowedSpecial: new Set() }).length + 24;
function value(x: unknown, max: number) {
  if (typeof x !== "string" || !x.trim() || x.length > max)
    throw invalid("Please shorten the message or journal selection.");
  return x.trim();
}
export function buildContext(body: Record<string, unknown>) {
  if (Object.keys(body).some((k) => !["message", "history", "journal", "requestId"].includes(k)))
    throw invalid();
  const message = value(body.message, 12000);
  if (!Array.isArray(body.history) || body.history.length > 32) throw invalid();
  const turns: Turn[] = body.history.map((t) => {
    if (!t || (t.role !== "user" && t.role !== "assistant")) throw invalid();
    return { role: t.role, content: value(t.content, 24000) };
  });
  const journal = body.journal === undefined ? undefined : value(body.journal, 16000);
  const tail = journal ? JSON.stringify({ selectedJournalExcerpt: journal, userMessage: message }) : message;
  const prefix: ModelMessage = { role: "system", content: staticPrefix };
  const limit = integer("OVI_CONTEXT_TOKENS", 4800, 100000);
  let tokens = cost(prefix.content) + cost(tail) + 128;
  if (tokens > limit) throw invalid("Please shorten the message or select a shorter journal excerpt.");
  // Include only complete recent exchanges. Failed/unanswered user turns are preserved in storage.
  const history: Turn[] = [];
  for (let i = turns.length - 1; i > 0; i--) {
    if (turns[i].role !== "assistant" || turns[i - 1].role !== "user") continue;
    const pair = turns.slice(i - 1, i + 1);
    const pairCost = cost(pair[0].content) + cost(pair[1].content);
    if (tokens + pairCost > limit) break;
    history.unshift(...pair);
    tokens += pairCost;
    i--;
  }
  return {
    messages: [prefix, ...history, { role: "user" as const, content: tail }],
    reservedTokens: tokens + outputLimit(),
  };
}
