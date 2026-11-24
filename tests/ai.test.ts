import test from "node:test";
import assert from "node:assert/strict";
import { buildContext } from "../lib/ai/context";
import { memoryProvider } from "../lib/ai/memory";
import { consumeGroq } from "../lib/ai/stream";
import { groqProvider, parseUsage } from "../lib/ai/provider";
import { makeWav, wavDuration, sampleRate } from "../lib/voice/wav";
import { selectJournal, selectedJournal, clearJournal } from "../lib/conversations/journal-selection";
import { readBytes } from "../lib/server/http";
import { readReply } from "../lib/conversations/stream-client";
import { POST as chat } from "../app/api/ai/chat/route";

test("static personality, complete exchanges, multilingual input, and explicit journal data", async () => {
  const history = [
    { role: "user", content: "aaj college tha" },
    { role: "assistant", content: "कैसा रहा?" },
    { role: "user", content: "unanswered" },
  ];
  const a = buildContext({ history, message: "all good", journal: "a photo note" });
  const b = buildContext({ history: [], message: "मुझे बस बात करनी है।" });
  assert.equal(a.messages[0].content, b.messages[0].content);
  assert.deepEqual(a.messages.slice(1, -1), history.slice(0, 2));
  assert.equal(JSON.parse(a.messages.at(-1)!.content).selectedJournalExcerpt, "a photo note");
  assert.deepEqual(await memoryProvider.getRelevantMemories({ uid: "a", query: "remember me?" }), []);
  assert.throws(() => buildContext({ history: [{ role: "system", content: "untrusted" }], message: "hey" }));
  assert.throws(() => buildContext({ history: [], message: "x".repeat(12001) }));
  assert.throws(() => buildContext({ history: [], message: "hello", uid: "bob" }));
});
test("journal handoff is one vault key only, and includes text and notes in order", () => {
  const key = {} as CryptoKey;
  selectJournal(key, "Saturday", {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Walking" }] },
      { type: "journalImage", attrs: { note: "Lake", imageId: "private-id" } },
    ],
  });
  assert.equal(selectedJournal(key)?.text, "Saturday\nWalking\nLake");
  assert.equal(selectedJournal({} as CryptoKey), undefined);
  clearJournal(key);
  assert.equal(selectedJournal(key), undefined);
});
const encoder = new TextEncoder();
function fragments(text: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of encoder.encode(text)) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
}
test("Groq streaming keeps only visible text, including split Unicode, and reads reported cache usage", async () => {
  const reply = { choices: [{ delta: { reasoning: "hidden", content: "हाँ" } }] },
    last = {
      choices: [{ finish_reason: "stop" }],
      x_groq: {
        usage: { prompt_tokens: 20, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 12 } },
      },
    };
  let text = "",
    usage;
  await consumeGroq(
    fragments(`data: ${JSON.stringify(reply)}\r\n\ndata: ${JSON.stringify(last)}\n\ndata: [DONE]\n\n`),
    (s) => {
      text += s;
    },
    (u) => {
      usage = u;
    },
  );
  assert.equal(text, "हाँ");
  assert.deepEqual(usage, { input: 20, output: 5, cached: 12 });
  assert.deepEqual(parseUsage({ prompt_tokens: 5, completion_tokens: 1 }), { input: 5, output: 1 });
  await assert.rejects(
    consumeGroq(
      fragments('data: {"choices":[]}\n'),
      () => {},
      () => {},
    ),
  );
  await assert.rejects(readReply(new Response(fragments('{"content":"partial"}\n')), () => {}));
});
test("provider adapter passes abort, suppresses reasoning and sanitizes invalid-key errors", async (t) => {
  const signal = new AbortController(),
    options = { messages: [], model: "openai/gpt-oss-120b", maxOutput: 64, signal: signal.signal };
  let status = 200;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    assert.equal(JSON.parse(String(init.body)).include_reasoning, false);
    assert.equal(init.signal, signal.signal);
    init.signal?.throwIfAborted();
    return new Response("private upstream body", { status });
  });
  assert.ok(await groqProvider.stream(options));
  status = 401;
  await assert.rejects(
    groqProvider.stream(options),
    (e) => e instanceof Error && !e.message.includes("private"),
  );
  signal.abort();
  await assert.rejects(groqProvider.stream(options), { name: "AbortError" });
});
test("identity required before parsing a private body", async () => {
  const r = await chat(new Request("http://localhost/api/ai/chat", { method: "POST", body: "{}" }));
  assert.equal(r.status, 401);
});
test("enforces actual body length and validates audio framing, duration and maximum", async () => {
  const blob = makeWav([new Float32Array(sampleRate * 2)], sampleRate * 2);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(wavDuration(bytes), 2);
  bytes[24] = 0;
  assert.equal(wavDuration(bytes), 0);
  assert.equal(wavDuration(bytes.slice(0, 20)), 0);
  assert.equal(wavDuration(new Uint8Array(44 + 2 * sampleRate * 121)), 0);
  await assert.rejects(
    readBytes(new Request("http://localhost", { method: "POST", body: blob }), 32, "audio/wav"),
  );
});
