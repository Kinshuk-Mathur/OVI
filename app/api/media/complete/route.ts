/** Confirm an upload against Storage metadata. A successful browser upload alone cannot finalize accounting. */
import { authenticatedUid } from "@/lib/server/firebase";
import { failure, privateHeaders, readJson } from "@/lib/server/http";
import { mediaIds, reconcile } from "@/lib/media/ledger";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const uid = await authenticatedUid(req),
      body = await readJson(req),
      { journalId, mediaId } = mediaIds(body);
    const result = await reconcile(uid, journalId, mediaId);
    return Response.json(result ?? { ok: true }, { headers: privateHeaders });
  } catch (error) {
    return failure(error);
  }
}
