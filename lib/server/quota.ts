import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { dayOf, integer, policy, resetAt } from "../ai/policy";
import { db } from "./firebase";
import { invalid, PublicError } from "./http";

type Kind = "chat" | "voice";
interface WindowEntry {
  id: string;
  at: number;
  tokens: number;
}
interface VoiceBucket {
  minute: number;
  seconds: number;
}
interface Lease {
  id: string;
  until: number;
  kind: Kind;
}
export interface Usage {
  input: number;
  output: number;
  cached?: number;
}
export interface Reservation {
  id: string;
  uid: string;
  kind: Kind;
  at: number;
  tokens: number;
  seconds: number;
}
export const providerBusy = (retryAt?: number) =>
  new PublicError(429, "OVI’s shared AI capacity is busy. Please try again later.", retryAt, "capacity");
export function requireId(id: unknown) {
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) throw invalid();
  return id;
}
function orgLimit(name: string, max?: number) {
  // Missing or invalid operator settings must fail before any provider request.
  if (process.env[name]) {
    try { return integer(name, 1, max); } catch { /* Report the same safe configuration error. */ }
  }
  throw new PublicError(503, "OVI’s server needs valid Groq usage limits before it can accept this request.", undefined, "quota_config");
}
const live = (leases: Lease[] = [], now: number) => leases.filter((l) => l.until > now);
const recent = (entries: WindowEntry[] = [], now: number) => entries.filter((e) => e.at > now - 60000);
// Minute buckets bound the size of the shared document. Keeping the oldest partial minute
// overestimates an hour by at most 59 seconds instead of undercounting concurrent recordings.
function voiceHour(buckets: VoiceBucket[] = [], now: number, at: number, change: number) {
  const minute = Math.floor(at / 60000);
  const sums = new Map(
    buckets.filter((b) => b.minute >= Math.floor(now / 60000) - 60).map((b) => [b.minute, b.seconds]),
  );
  if (change > 0 || sums.has(minute)) sums.set(minute, Math.max(0, (sums.get(minute) ?? 0) + change));
  return [...sums].map(([minute, seconds]) => ({ minute, seconds }));
}
const refs = (r: Reservation) => {
  const store = db(),
    day = dayOf(r.at);
  return {
    user: store.doc(`userUsage/${r.uid}`),
    userDay: store.doc(`userUsage/${r.uid}/days/${day}`),
    org: store.doc("systemUsage/live"),
    orgDay: store.doc(`systemUsage/${day}`),
    ticket: store.doc(`quotaReservations/${r.id}`),
  };
};

/** Atomically reserve maximum billed work before contacting Groq. The rolling windows and leases
 * span midnight; daily counters use the admission date. An abandoned lease expires, but its
 * estimated cost remains charged because the provider may already have processed the request. */
export async function reserve(
  uid: string,
  kind: Kind,
  requestId: string,
  tokens = 0,
  seconds = 0,
  at = Date.now(),
) {
  if (kind === "voice" && (!Number.isInteger(seconds) || seconds < 1 || seconds > 120)) throw invalid();
  const billedSeconds = kind === "voice" ? Math.max(10, seconds) : 0;
  const id = createHash("sha256")
    .update(JSON.stringify([uid, kind, requireId(requestId)]))
    .digest("hex");
  const r = { id, uid, kind, at, tokens, seconds },
    docs = refs(r),
    limits = policy();
  const rpm = orgLimit("OVI_ORG_RPM", 1000),
    rpd = orgLimit("OVI_ORG_RPD"),
    tpm = orgLimit("OVI_ORG_TPM"),
    tpd = orgLimit("OVI_ORG_TPD");
  await db().runTransaction(async (tx) => {
    const [ticket, user, day, org, globalDay] = await tx.getAll(
      docs.ticket,
      docs.user,
      docs.userDay,
      docs.org,
      docs.orgDay,
    );
    if (ticket.exists) throw new PublicError(409, "This request has already been received.");
    const g = org.data() ?? {},
      u = user.data() ?? {},
      d = day.data() ?? {},
      total = globalDay.data() ?? {};
    const active = live(g.active, at),
      own = live(u.active, at),
      window = recent(g.window, at),
      attempts = recent(u[kind], at);
    if (own.some((l) => l.kind === kind))
      throw new PublicError(429, "One request is already in progress.", undefined, "busy");
    if (attempts.length >= limits.burst)
      throw new PublicError(429, "Give OVI a moment before trying again.", attempts[0].at + 60000, "burst");
    if (kind === "chat" && (d.chat ?? 0) >= limits.dailyChat)
      throw new PublicError(
        429,
        "That's all for today's conversations. You can talk with OVI again after your limit resets.",
        resetAt(at),
        "chat_daily",
      );
    if (kind === "voice" && (d.seconds ?? 0) + seconds > limits.voiceSeconds)
      throw new PublicError(
        429,
        "You've used today's voice minutes. You can still type to OVI.",
        resetAt(at),
        "voice_daily",
      );
    if (g.retryAt > at) throw providerBusy(g.retryAt);
    if ((total.requests ?? 0) >= rpd || (total.tokens ?? 0) + tokens > tpd) throw providerBusy(resetAt(at));
    if (
      window.length >= rpm ||
      window.reduce((sum, e) => sum + e.tokens, tokens) > tpm ||
      active.length >= integer("OVI_ORG_CONCURRENCY", 3, 50)
    )
      throw providerBusy(at + 60000);
    const buckets = voiceHour(g.voiceHour, at, at, billedSeconds);
    if (
      kind === "voice" &&
      (buckets.reduce((sum, b) => sum + b.seconds, 0) > orgLimit("OVI_ORG_AUDIO_SECONDS_HOUR") ||
        (total.billedSeconds ?? 0) + billedSeconds > orgLimit("OVI_ORG_AUDIO_SECONDS_DAY"))
    )
      throw providerBusy(at + 60000);
    const entry = { id, at, tokens },
      lease = { id, kind, until: at + 120000 };
    tx.set(docs.user, { active: [...own, lease], [kind]: [...attempts, entry] }, { merge: true });
    tx.set(
      docs.org,
      { active: [...active, lease], window: [...window, entry], voiceHour: buckets },
      { merge: true },
    );
    tx.set(
      docs.userDay,
      { chat: FieldValue.increment(kind === "chat" ? 1 : 0), seconds: FieldValue.increment(seconds) },
      { merge: true },
    );
    tx.set(
      docs.orgDay,
      {
        requests: FieldValue.increment(1),
        tokens: FieldValue.increment(tokens),
        billedSeconds: FieldValue.increment(billedSeconds),
        seconds: FieldValue.increment(seconds),
      },
      { merge: true },
    );
    tx.create(docs.ticket, { ...r, state: "reserved", expiresAt: new Date(at + 7 * 86400000) });
  });
  return r;
}
export interface Outcome {
  model: string;
  category: "complete" | "interrupted" | "rejected";
  usage?: Usage;
  retryAt?: number;
}
/** A definite upstream rejection refunds the user allowance. Request attempts remain in burst and
 * organization request counters. Unknown usage keeps its upper bound, including on cancellation. */
export async function settle(r: Reservation, outcome: Outcome) {
  const docs = refs(r),
    { usage, category, model } = outcome;
  await db().runTransaction(async (tx) => {
    const [ticket, user, org] = await tx.getAll(docs.ticket, docs.user, docs.org);
    if (ticket.get("state") !== "reserved") return;
    const now = Date.now(),
      rejected = category === "rejected";
    const tokens = usage ? usage.input + usage.output - (usage.cached ?? 0) : rejected ? 0 : r.tokens;
    const remaining = (leases: Lease[]) => live(leases, now).filter((l) => l.id !== r.id);
    const window = recent(org.get("window"), now).map((e) => (e.id === r.id ? { ...e, tokens } : e));
    const refundedSeconds = rejected && r.kind === "voice" ? Math.max(10, r.seconds) : 0;
    tx.update(docs.org, {
      voiceHour: voiceHour(org.get("voiceHour"), now, r.at, -refundedSeconds),
      active: remaining(org.get("active")),
      window,
      retryAt: Math.max(org.get("retryAt") || 0, outcome.retryAt || 0),
    });
    tx.update(docs.user, { active: remaining(user.get("active")) });
    if (rejected)
      tx.update(docs.userDay, {
        chat: FieldValue.increment(r.kind === "chat" ? -1 : 0),
        seconds: FieldValue.increment(-r.seconds),
      });
    tx.update(docs.orgDay, {
      tokens: FieldValue.increment(tokens - r.tokens),
      billedSeconds: FieldValue.increment(-refundedSeconds),
      seconds: FieldValue.increment(rejected ? -r.seconds : 0),
      input: FieldValue.increment(usage?.input ?? 0),
      output: FieldValue.increment(usage?.output ?? 0),
      rateLimited: FieldValue.increment(outcome.retryAt ? 1 : 0),
    });
    tx.update(docs.ticket, {
      state: category,
      model,
      latencyMs: now - r.at,
      ...(usage
        ? {
            usage,
            estimatedCostUSD:
              ((usage.input - (usage.cached ?? 0)) * 0.15 +
                (usage.cached ?? 0) * 0.075 +
                usage.output * 0.6) /
              1e6,
          }
        : {}),
    });
  });
}
