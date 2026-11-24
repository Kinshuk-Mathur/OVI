/** Accept only the recorder’s validated PCM format. Reserve transcription seconds independently from AI messages. */
import { model, transcribe, UpstreamRejection } from "@/lib/ai/provider";
import { authenticatedUid } from "@/lib/server/firebase";
import { failure, invalid, privateHeaders, readBytes } from "@/lib/server/http";
import { requireId, reserve, settle, type Outcome } from "@/lib/server/quota";
import { maxWavBytes, wavDuration } from "@/lib/voice/wav";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const uid = await authenticatedUid(req),
      id = requireId(req.headers.get("x-request-id"));
    const bytes = await readBytes(req, maxWavBytes, "audio/wav"),
      seconds = wavDuration(bytes);
    if (!seconds) throw invalid("Record up to two minutes of audio using the OVI microphone.");
    const name = model("voice"),
      ticket = await reserve(uid, "voice", id, 0, seconds);
    let result: Outcome = { model: name, category: "interrupted" };
    try {
      const text = await transcribe(
        new Blob([new Uint8Array(bytes)], { type: "audio/wav" }),
        name,
        AbortSignal.any([req.signal, AbortSignal.timeout(45000)]),
      );
      result.category = "complete";
      return Response.json({ text }, { headers: privateHeaders });
    } catch (error) {
      if (error instanceof UpstreamRejection)
        result = { model: name, category: "rejected", retryAt: error.retryAt };
      throw error;
    } finally {
      bytes.fill(0);
      await settle(ticket, result);
    }
  } catch (error) {
    return failure(error);
  }
}
