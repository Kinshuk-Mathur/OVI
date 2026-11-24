/** Return only the signed-in owner’s remaining allowance and actual stored bytes. Never expose organization counters. */
import { dayOf, policy, resetAt } from "@/lib/ai/policy";
import { ensureMediaAccount, releaseExpiredPhotos } from "@/lib/media/ledger";
import { authenticatedUid, db } from "@/lib/server/firebase";
import { failure, privateHeaders } from "@/lib/server/http";
export async function GET(req: Request) {
  try {
    const uid = await authenticatedUid(req),
      now = Date.now(),
      day = dayOf(now),
      limits = policy();
    await ensureMediaAccount(uid);
    await releaseExpiredPhotos(uid);
    const [user, photos, storage] = await db().getAll(
      db().doc(`userUsage/${uid}/days/${day}`),
      db().doc(`mediaUsage/${uid}/days/${day}`),
      db().doc(`mediaUsage/${uid}`),
    );
    return Response.json(
      {
        messages: Math.max(0, limits.dailyChat - (user.get("chat") ?? 0)),
        voiceSeconds: Math.max(0, limits.voiceSeconds - (user.get("seconds") ?? 0)),
        photos: Math.max(0, limits.dailyPhotos - (photos.get("uploads") ?? 0)),
        storageBytes: Math.max(0, storage.get("bytes") - (storage.get("reservedBytes") ?? 0)),
        storageLimit: limits.storageBytes,
        resetAt: resetAt(now),
      },
      { headers: privateHeaders },
    );
  } catch (error) {
    return failure(error);
  }
}
