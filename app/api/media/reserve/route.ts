/** Authorize one immutable object beneath the verified owner’s journal path. No caller-supplied UID is used. */
import { authenticatedUid } from "@/lib/server/firebase";
import { failure, privateHeaders, readJson } from "@/lib/server/http";
import { mediaIds, reservePhoto } from "@/lib/media/ledger";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const uid = await authenticatedUid(req),
      body = await readJson(req),
      { journalId, mediaId } = mediaIds(body);
    const result = await reservePhoto(uid, journalId, mediaId, body.size);
    return Response.json(result ?? { ok: true }, { headers: privateHeaders });
  } catch (error) {
    return failure(error);
  }
}
