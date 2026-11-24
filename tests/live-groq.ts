/** Opt-in, paid-provider evaluation. The inputs below are synthetic. Never substitute private
 * journals. Print responses for human language/behavior review; a nonempty reply is not a quality score. */
import { loadEnvConfig } from "@next/env";
import { readFile } from "node:fs/promises";
import { buildContext } from "../lib/ai/context";
import { groqProvider, model, transcribe } from "../lib/ai/provider";
import { consumeGroq } from "../lib/ai/stream";
import cases from "./ai-evaluations.json";

async function run() {
  loadEnvConfig(process.cwd());
  const selection = process.argv[2];
  if (selection === "voice") {
    const wav = await readFile(process.argv[3]);
    console.log(
      await transcribe(
        new Blob([new Uint8Array(wav)], { type: "audio/wav" }),
        model("voice"),
        AbortSignal.timeout(45000),
      ),
    );
    return;
  }
  const index = Number(selection);
  if (!Number.isInteger(index) || !cases[index])
    throw new Error(
      "Select one synthetic evaluation by its zero-based index, or voice and a synthetic WAV path.",
    );
  const sample = cases[index],
    { messages } = buildContext({ message: sample.message, history: sample.history ?? [] });
  const stream = await groqProvider.stream({
    messages,
    model: model("chat"),
    maxOutput: 768,
    signal: AbortSignal.timeout(55000),
  });
  let reply = "";
  await consumeGroq(
    stream,
    (s) => {
      reply += s;
    },
    (usage) => console.log(JSON.stringify(usage)),
  );
  console.log(sample.case, reply);
}
run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
