/** Authenticated chat pipeline. Admit a bounded context, stream visible text, then finalize usage before reporting completion. */
import { buildContext, outputLimit } from "@/lib/ai/context";
import { groqProvider, model, UpstreamRejection } from "@/lib/ai/provider";
import { consumeGroq } from "@/lib/ai/stream";
import { authenticatedUid } from "@/lib/server/firebase";
import { failure, privateHeaders, readJson } from "@/lib/server/http";
import { requireId, reserve, settle, type Usage } from "@/lib/server/quota";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const uid = await authenticatedUid(request),
      body = await readJson(request, 128 * 1024);
    const { messages, reservedTokens } = buildContext(body),
      name = model("chat");
    const ticket = await reserve(uid, "chat", requireId(body.requestId), reservedTokens);
    const controller = new AbortController();
    const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(55000)]);
    let upstream;
    try {
      upstream = await groqProvider.stream({ messages, maxOutput: outputLimit(), model: name, signal });
    } catch (error) {
      const rejected = error instanceof UpstreamRejection;
      await settle(ticket, {
        model: name,
        category: rejected ? "rejected" : "interrupted",
        retryAt: rejected ? error.retryAt : undefined,
      });
      throw error;
    }
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(out) {
        let usage: Usage | undefined,
          complete = false;
        const send = (data: object) => out.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
        try {
          await consumeGroq(
            upstream,
            (content) => send({ content }),
            (value) => {
              usage = value;
            },
          );
          complete = true;
        } catch {
          /* Preserve the user turn and mark partial text as interrupted on the client. */
        }
        try {
          await settle(ticket, { model: name, category: complete ? "complete" : "interrupted", usage });
          if (!signal.aborted) send(complete ? { done: true } : { error: "OVI’s reply was interrupted." });
        } finally {
          if (!controller.signal.aborted) out.close();
        }
      },
      cancel() {
        controller.abort();
      },
    });
    return new Response(stream, {
      headers: {
        ...privateHeaders,
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
