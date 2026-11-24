/** Remove a photo after its journal revision is committed and release its bytes after Storage confirms deletion. */
import { authenticatedUid } from "@/lib/server/firebase";
import { failure, privateHeaders, readJson } from "@/lib/server/http";
import { mediaIds, removePhoto } from "@/lib/media/ledger";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const uid = await authenticatedUid(req),
      body = await readJson(req),
      { journalId, mediaId } = mediaIds(body);
    const result = await removePhoto(uid, journalId, mediaId, body.revision);
    return Response.json(result ?? { ok: true }, { headers: privateHeaders });
  } catch (error) {
    return failure(error);
  }
}
