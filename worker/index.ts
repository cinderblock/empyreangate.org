/**
 * The site's server code, all under `/api/`: `POST /api/submit`, the
 * playground's Submit; `/api/notify/*`, the crew's push subscriptions;
 * `/api/submissions*`, the queue for the gate's Patch tab (admin token);
 * `GET /api/live`, whether the gate's public floor is up and what it is
 * playing. Everything else is the prerendered static site, served from
 * assets without waking this Worker (`assets.run_worker_first` in
 * wrangler.jsonc covers `/api/*` only).
 *
 * A submission is a patch plus who sent it. It is checked (Turnstile, size,
 * shape), then written to R2 as one JSON object for us to review; nothing is
 * published or run anywhere automatically. The gate re-validates a patch when
 * it is imported, so this only needs to keep junk and abuse out.
 */

import { parsePatchFile } from "@empyrean-gate/patch-web/files";
import { sendPush, type PushSubscriptionJSON, type Vapid } from "./webpush";

/** The subset of the Workers runtime this file uses. */
interface R2Bucket {
  put(
    key: string,
    value: string,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  list(options: {
    prefix: string;
    limit?: number;
  }): Promise<{ objects: { key: string }[]; truncated: boolean }>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  delete(key: string): Promise<void>;
}
/** The Workers rate-limiting binding (`ratelimits` in wrangler.jsonc). */
interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}
interface Fetcher {
  fetch(request: Request): Promise<Response>;
}
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface Env {
  ASSETS: Fetcher;
  /** Where submissions land. Absent on builds without it bound. */
  SUBMISSIONS?: R2Bucket;
  /** Per-visitor rate limit (wrangler.jsonc: a few a minute per IP). */
  SUBMIT_LIMIT?: RateLimit;
  /** Turnstile secret for the site key the page uses. */
  TURNSTILE_SECRET?: string;
  /** Optional: a Discord/Slack-style webhook told about each submission. */
  NOTIFY_WEBHOOK?: string;
  /** Web Push to the crew's installed PWA (worker/webpush.ts, /admin). The
   * pair from `bun run vapid`; the token the /admin page must present. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  ADMIN_TOKEN?: string;
  /** The gate's public floor (`vars` in wrangler.jsonc), for `/api/live`.
   * Unset on a build without one: then nothing is ever live. */
  LIVE_URL?: string;
}

/** Where push subscriptions live in the bucket, and how many at most. */
const NOTIFY_PREFIX = "notify/";
const MAX_SUBSCRIPTIONS = 50;
/** What the push service may contact about this sender (RFC 8292). */
const VAPID_SUBJECT = "https://empyreangate.org";

/** Overridable in tests: how push messages leave. */
export const deps = {
  fetch: (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    fetch(input, init),
};

/** Limits, generous for any real patch (the gate caps a patch at 256 nodes). */
export const LIMITS = {
  // Patches carry up to 4 Still images (≤ 600 KB data URLs each).
  bodyBytes: 3 * 1024 * 1024,
  name: 80,
  contact: 200,
  message: 2000,
  nodes: 256,
  edges: 1024,
  // How many submissions a day the bucket accepts, in all. A cap on growth
  // rather than a target: at the 3 MB body limit a full day is 300 MB, so
  // even a month of abuse stays within R2's free 10 GB. Checked with one
  // list call per accepted submission, after the spam check.
  perDay: 100,
  // How many of those one visitor may send, so nobody can spend the whole
  // day's cap alone. A visitor is an IPv4 address or an IPv6 /64.
  perVisitorPerDay: 10,
  // Longest patch name quoted in a notification: a Web Push payload must
  // stay under ~4 KB, and a patch name is otherwise unbounded.
  notifyName: 80,
};

export interface Submission {
  patch: unknown;
  name: string;
  contact: string;
  message: string;
  /** The visitor agreed to the terms shown next to the Submit button. */
  agreed: boolean;
  turnstile: string;
}

type PushEnv = Env & {
  SUBMISSIONS: R2Bucket;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  ADMIN_TOKEN: string;
};

function pushReady(env: Env): env is PushEnv {
  return Boolean(
    env.SUBMISSIONS &&
    env.VAPID_PUBLIC_KEY &&
    env.VAPID_PRIVATE_KEY &&
    env.ADMIN_TOKEN,
  );
}

const te = new TextEncoder();

function sameSecret(a: string, b: string): boolean {
  const x = te.encode(a);
  const y = te.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** The queue and the push subscriptions share the admin token. */
type AdminEnv = Env & { SUBMISSIONS: R2Bucket; ADMIN_TOKEN: string };

function adminReady(env: Env): env is AdminEnv {
  return Boolean(env.SUBMISSIONS && env.ADMIN_TOKEN);
}

function authorized(request: Request, env: { ADMIN_TOKEN: string }): boolean {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return token.length > 0 && sameSecret(token, env.ADMIN_TOKEN);
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function subscriptionKey(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", te.encode(endpoint));
  return `${NOTIFY_PREFIX}${hex(digest).slice(0, 32)}.json`;
}

/** Who a request is from, for the caps: an IPv4 address as it is, an IPv6
 * address as its /64, since one phone or household can rotate through a
 * whole /64 at will. */
export function visitorAddress(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head, tail] = ip.toLowerCase().split("::");
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  const groups =
    tail === undefined
      ? front
      : [
          ...front,
          ...Array(Math.max(0, 8 - front.length - back.length)).fill("0"),
          ...back,
        ];
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

/** A visitor's segment in a submission's key: a keyed hash of their address,
 * so the bucket can count one visitor's submissions without holding their
 * IP. Keyed with the Turnstile secret, which every accepting build has;
 * rotating it only restarts today's counts. */
async function visitorId(secret: string, address: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    te.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, te.encode(address))).slice(
    0,
    16,
  );
}

/** `text`, cut to `max` characters with an ellipsis if it was longer. */
function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function parseSubscription(raw: unknown): PushSubscriptionJSON | null {
  const s = raw as Partial<PushSubscriptionJSON> | null;
  if (!s || typeof s !== "object" || typeof s.endpoint !== "string")
    return null;
  if (!s.endpoint.startsWith("https://") || s.endpoint.length > 2000)
    return null;
  const keys = s.keys as Partial<PushSubscriptionJSON["keys"]> | undefined;
  if (!keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string")
    return null;
  return {
    endpoint: s.endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
  };
}

export interface PushMessage {
  title: string;
  body: string;
  /** Opened when the notification is tapped (the service worker's default
   * is /admin). */
  url?: string;
  /** Notifications with the same tag replace each other. */
  tag?: string;
}

/** Push `message` to every subscribed device; subscriptions the push
 * service reports gone (404, 410) are dropped. Returns how many accepted. */
export async function broadcast(
  env: PushEnv,
  message: PushMessage,
): Promise<number> {
  const vapid: Vapid = {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: VAPID_SUBJECT,
  };
  const list = await env.SUBMISSIONS.list({
    prefix: NOTIFY_PREFIX,
    limit: MAX_SUBSCRIPTIONS,
  });
  let sent = 0;
  for (const obj of list.objects) {
    const stored = await env.SUBMISSIONS.get(obj.key);
    if (!stored) continue;
    let sub: PushSubscriptionJSON | null = null;
    try {
      sub = parseSubscription(
        (JSON.parse(await stored.text()) as { subscription?: unknown })
          .subscription,
      );
    } catch {
      sub = null;
    }
    if (!sub) {
      await env.SUBMISSIONS.delete(obj.key);
      continue;
    }
    try {
      const res = await sendPush(sub, JSON.stringify(message), vapid, {
        fetch: deps.fetch,
        topic: message.tag,
        urgency: "high",
      });
      if (res.status === 404 || res.status === 410) {
        await env.SUBMISSIONS.delete(obj.key);
      } else if (res.ok) {
        sent++;
      }
    } catch (e) {
      // A push service that is down loses one message; the next one tries again.
      console.error("Push to one device failed:", e);
    }
  }
  return sent;
}

/** `/api/notify/*`: the crew's push subscriptions (see /admin). */
async function notify(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === "/api/notify/key") {
    if (request.method !== "GET") return json(405, { error: "GET the key." });
    if (!pushReady(env)) {
      return json(503, {
        error: "Notifications aren't set up on this build yet.",
      });
    }
    return json(200, { key: env.VAPID_PUBLIC_KEY });
  }
  if (!pushReady(env)) {
    return json(503, {
      error: "Notifications aren't set up on this build yet.",
    });
  }
  if (!authorized(request, env)) {
    return json(401, { error: "That admin token isn't right." });
  }
  if (url.pathname === "/api/notify/subscribe") {
    let body: { subscription?: unknown; endpoint?: unknown; label?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json(400, { error: "That request wasn't JSON." });
    }
    if (request.method === "POST") {
      const sub = parseSubscription(body.subscription);
      if (!sub) return json(400, { error: "That isn't a push subscription." });
      const key = await subscriptionKey(sub.endpoint);
      const existing = await env.SUBMISSIONS.list({
        prefix: NOTIFY_PREFIX,
        limit: MAX_SUBSCRIPTIONS,
      });
      if (
        !existing.objects.some((o) => o.key === key) &&
        (existing.truncated || existing.objects.length >= MAX_SUBSCRIPTIONS)
      ) {
        return json(429, {
          error: "That's every device slot taken. Remove one first.",
        });
      }
      const record = {
        subscription: sub,
        label: typeof body.label === "string" ? body.label.slice(0, 80) : "",
        addedAt: new Date().toISOString(),
        userAgent: request.headers.get("user-agent"),
      };
      await env.SUBMISSIONS.put(key, JSON.stringify(record, null, 2), {
        httpMetadata: { contentType: "application/json" },
      });
      return json(200, { ok: true });
    }
    if (request.method === "DELETE") {
      if (typeof body.endpoint !== "string")
        return json(400, { error: "Which endpoint?" });
      await env.SUBMISSIONS.delete(await subscriptionKey(body.endpoint));
      return json(200, { ok: true });
    }
    return json(405, { error: "POST or DELETE a subscription here." });
  }
  if (url.pathname === "/api/notify/test") {
    if (request.method !== "POST")
      return json(405, { error: "POST to send a test." });
    const sent = await broadcast(env, {
      title: "The Empyrean Gate",
      body: "Notifications reach this device.",
      tag: "test",
    });
    return json(200, { ok: true, sent });
  }
  return json(404, { error: "No such endpoint." });
}

function json(
  status: number,
  body: unknown,
  cacheControl = "no-store",
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheControl,
    },
  });
}

// ---------------------------------------------------------------------------
// The gate, live: /api/live
// ---------------------------------------------------------------------------

/** What `/api/live` answers, from the floor's `/health` (docs/public-deploy.md
 * in the gate repo). Nothing in it is private: the floor's own page shows
 * the same. */
export interface Live {
  live: boolean;
  /** Where to play, when live. */
  url?: string;
  /** The floor's master switch (the listener can be up with the floor closed). */
  open?: boolean;
  players?: number;
  /** The running game's kind, if any. */
  game?: string | null;
  /** The patch on air and who it credits; null while the layer stack renders. */
  nowPlaying?: { name: string; credit: string } | null;
}

/** How long one isolate keeps the floor's answer. The home page asks on
 * every visit; the gate should hear from a few edges a minute, not from
 * every visitor. */
export const LIVE_TTL_MS = 10_000;
/** How long to wait for the floor; a dark gate must not slow the page. */
const LIVE_TIMEOUT_MS = 4_000;
const liveMemo = new Map<string, { at: number; body: Live }>();

/** For tests: forget what the floor said. */
export function forgetLive(): void {
  liveMemo.clear();
}

async function askFloor(url: string): Promise<Live> {
  const base = url.replace(/\/+$/, "");
  try {
    const res = await deps.fetch(`${base}/health`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
    });
    if (!res.ok) return { live: false };
    const out: Live = { live: true, url: base };
    // Older gates answer 204 with no body: up, nothing more to say.
    if ((res.headers.get("content-type") ?? "").includes("json")) {
      const h = (await res.json()) as {
        open?: unknown;
        players?: unknown;
        game?: unknown;
        now_playing?: unknown;
      };
      if (typeof h.open === "boolean") out.open = h.open;
      if (typeof h.players === "number") out.players = h.players;
      out.game = typeof h.game === "string" ? h.game : null;
      const np = h.now_playing as { name?: unknown; credit?: unknown } | null;
      out.nowPlaying =
        np && typeof np === "object" && typeof np.name === "string"
          ? {
              name: clip(np.name, 80),
              credit: typeof np.credit === "string" ? clip(np.credit, 80) : "",
            }
          : null;
    }
    return out;
  } catch {
    // Down, or no tunnel yet: not live, and nothing worth logging.
    return { live: false };
  }
}

async function live(env: Env): Promise<Response> {
  if (!env.LIVE_URL) return json(200, { live: false }, "public, max-age=60");
  const now = Date.now();
  const memo = liveMemo.get(env.LIVE_URL);
  if (memo && now - memo.at < LIVE_TTL_MS) {
    return json(200, memo.body, `public, max-age=${LIVE_TTL_MS / 1000}`);
  }
  const body = await askFloor(env.LIVE_URL);
  liveMemo.set(env.LIVE_URL, { at: now, body });
  return json(200, body, `public, max-age=${LIVE_TTL_MS / 1000}`);
}

// ---------------------------------------------------------------------------
// The queue, for the gate's Patch tab: /api/submissions
// ---------------------------------------------------------------------------

const SUBMISSIONS_PREFIX = "submissions/";
/** Where a decided submission goes: `reviewed/<decision>/<rest of key>`. */
const REVIEWED_PREFIX = "reviewed/";
/** How many of the newest the list carries; each is one read. */
const LIST_LIMIT = 100;

/** One queue entry as the list carries it: the record without its patch,
 * plus the patch's name and size. */
export interface SubmissionSummary {
  key: string;
  id: string;
  submittedAt: string;
  name: string;
  contact: string;
  message: string;
  country: string | null;
  patch: { name: string; description: string; nodes: number; edges: number };
}

/** When a key was written: its leaf is `<ms>-<uuid>.json`. */
export function keyTime(key: string): number {
  const leaf = key.slice(key.lastIndexOf("/") + 1);
  return Number(leaf.split("-")[0]) || 0;
}

function summarize(key: string, record: unknown): SubmissionSummary {
  const r = (record && typeof record === "object" ? record : {}) as Record<
    string,
    unknown
  >;
  const patch = (r.patch && typeof r.patch === "object" ? r.patch : {}) as {
    name?: unknown;
    description?: unknown;
    nodes?: unknown;
    edges?: unknown;
  };
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    key,
    id: str(r.id),
    submittedAt: str(r.submittedAt),
    name: str(r.name),
    contact: str(r.contact),
    message: str(r.message),
    country: typeof r.country === "string" ? r.country : null,
    patch: {
      name: str(patch.name),
      description: str(patch.description),
      nodes: Array.isArray(patch.nodes) ? patch.nodes.length : 0,
      edges: Array.isArray(patch.edges) ? patch.edges.length : 0,
    },
  };
}

function submissionKeyOk(key: string, prefixes: string[]): boolean {
  return (
    prefixes.some((p) => key.startsWith(p)) &&
    key.endsWith(".json") &&
    !key.includes("..")
  );
}

/** `/api/submissions`: the queue, newest first, for the gate's Patch tab
 * (through its backend, which holds the admin token) and the crew.
 * `?key=` reads one record; `POST /api/submissions/decide` moves one out of
 * the queue under `reviewed/<used|declined>/`, keeping it. */
async function submissions(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  if (!adminReady(env)) {
    return json(503, { error: "Submissions aren't set up on this build yet." });
  }
  if (!authorized(request, env)) {
    return json(401, { error: "That admin token isn't right." });
  }
  if (url.pathname === "/api/submissions") {
    if (request.method !== "GET") return json(405, { error: "GET the queue." });
    const key = url.searchParams.get("key");
    if (key !== null) {
      if (!submissionKeyOk(key, [SUBMISSIONS_PREFIX, REVIEWED_PREFIX])) {
        return json(400, { error: "That isn't a submission key." });
      }
      const stored = await env.SUBMISSIONS.get(key);
      if (!stored) return json(404, { error: "No such submission." });
      let record: unknown;
      try {
        record = JSON.parse(await stored.text());
      } catch {
        return json(500, { error: "That submission can't be read." });
      }
      return json(200, { submission: { key, ...(record as object) } });
    }
    const list = await env.SUBMISSIONS.list({
      prefix: SUBMISSIONS_PREFIX,
      limit: 1000,
    });
    const keys = list.objects
      .map((o) => o.key)
      .sort((a, b) => keyTime(b) - keyTime(a))
      .slice(0, LIST_LIMIT);
    const out: SubmissionSummary[] = [];
    // A few reads at a time: the queue is short, the Patch tab is waiting.
    for (let i = 0; i < keys.length; i += 10) {
      const chunk = await Promise.all(
        keys.slice(i, i + 10).map(async (k) => {
          const stored = await env.SUBMISSIONS.get(k);
          if (!stored) return null;
          try {
            return summarize(k, JSON.parse(await stored.text()));
          } catch {
            return null;
          }
        }),
      );
      for (const s of chunk) if (s) out.push(s);
    }
    return json(200, {
      submissions: out,
      truncated: list.truncated || list.objects.length > LIST_LIMIT,
    });
  }
  if (url.pathname === "/api/submissions/decide") {
    if (request.method !== "POST") {
      return json(405, { error: "POST a decision." });
    }
    let body: { key?: unknown; decision?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json(400, { error: "That request wasn't JSON." });
    }
    const key = typeof body.key === "string" ? body.key : "";
    if (!submissionKeyOk(key, [SUBMISSIONS_PREFIX])) {
      return json(400, { error: "That isn't a queued submission's key." });
    }
    const decision = body.decision;
    if (decision !== "used" && decision !== "declined") {
      return json(400, { error: "A decision is used or declined." });
    }
    const stored = await env.SUBMISSIONS.get(key);
    if (!stored) return json(404, { error: "No such submission." });
    const text = await stored.text();
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(text) as Record<string, unknown>;
    } catch {
      record = { raw: text };
    }
    const reviewedKey = `${REVIEWED_PREFIX}${decision}/${key.slice(SUBMISSIONS_PREFIX.length)}`;
    await env.SUBMISSIONS.put(
      reviewedKey,
      JSON.stringify(
        { ...record, decision, decidedAt: new Date().toISOString() },
        null,
        2,
      ),
      { httpMetadata: { contentType: "application/json" } },
    );
    await env.SUBMISSIONS.delete(key);
    return json(200, { ok: true, key: reviewedKey });
  }
  return json(404, { error: "No such endpoint." });
}

/** Check a submission's fields; returns an error message or null. */
export function checkSubmission(s: Partial<Submission>): string | null {
  if (typeof s.name !== "string" || !s.name.trim()) return "Tell us your name.";
  if (s.name.length > LIMITS.name) return "That name is too long.";
  if (typeof s.contact !== "string" || s.contact.length > LIMITS.contact) {
    return "That contact is too long.";
  }
  if (typeof s.message !== "string" || s.message.length > LIMITS.message) {
    return "That message is too long.";
  }
  if (s.agreed !== true) return "Please agree to the terms to submit.";
  return null;
}

async function verifyTurnstile(
  secret: string,
  token: string,
  ip: string | null,
): Promise<boolean> {
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const res = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body: form },
  );
  const out = (await res.json()) as { success?: boolean };
  return out.success === true;
}

async function submit(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!env.SUBMISSIONS || !env.TURNSTILE_SECRET) {
    return json(503, { error: "Submissions aren't open on this build yet." });
  }
  const ip = request.headers.get("cf-connecting-ip");
  const visitor = visitorAddress(ip ?? "unknown");
  // Cheapest check first: a visitor sending more than a few a minute is a
  // script, and this costs nothing (no body read, no R2 call).
  if (env.SUBMIT_LIMIT && ip) {
    const { success } = await env.SUBMIT_LIMIT.limit({ key: visitor });
    if (!success) {
      return json(429, {
        error:
          "That's a lot of patterns at once. Give it a minute and try again.",
      });
    }
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > LIMITS.bodyBytes) {
    return json(413, { error: "That patch is too big." });
  }
  const text = await request.text();
  if (text.length > LIMITS.bodyBytes) {
    return json(413, { error: "That patch is too big." });
  }

  let body: Partial<Submission>;
  try {
    body = JSON.parse(text) as Partial<Submission>;
  } catch {
    return json(400, { error: "That request wasn't JSON." });
  }
  const problem = checkSubmission(body);
  if (problem) return json(400, { error: problem });

  let patch;
  try {
    patch = parsePatchFile(JSON.stringify(body.patch));
  } catch (e) {
    return json(400, {
      error: e instanceof Error ? e.message : "Not a patch.",
    });
  }
  if (patch.nodes.length > LIMITS.nodes || patch.edges.length > LIMITS.edges) {
    return json(400, {
      error: "That patch has more nodes than the gate allows.",
    });
  }

  if (
    typeof body.turnstile !== "string" ||
    !(await verifyTurnstile(env.TURNSTILE_SECRET, body.turnstile, ip))
  ) {
    return json(403, { error: "The spam check didn't pass. Try again." });
  }

  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  // The daily caps, after the spam check so bots cannot spend them: first
  // this visitor's share (their own prefix under today's), then the day's.
  const mine = `submissions/${day}/${await visitorId(env.TURNSTILE_SECRET, visitor)}/`;
  const theirs = await env.SUBMISSIONS.list({
    prefix: mine,
    limit: LIMITS.perVisitorPerDay,
  });
  if (theirs.truncated || theirs.objects.length >= LIMITS.perVisitorPerDay) {
    return json(429, {
      error:
        "That's as many patterns as we can take from one person in a day. Save yours to disk and send it tomorrow.",
    });
  }
  // Full means we have all we can look at for one day.
  const today = await env.SUBMISSIONS.list({
    prefix: `submissions/${day}/`,
    limit: LIMITS.perDay,
  });
  if (today.truncated || today.objects.length >= LIMITS.perDay) {
    return json(429, {
      error:
        "We've received all the patterns we can look at today. Save yours to disk and send it tomorrow.",
    });
  }

  const id = crypto.randomUUID();
  const key = `${mine}${now.getTime()}-${id}.json`;
  const cf = (request as Request & { cf?: { country?: string } }).cf;
  const record = {
    id,
    submittedAt: now.toISOString(),
    name: body.name!.trim(),
    contact: body.contact!.trim(),
    message: body.message!.trim(),
    agreed: true,
    country: cf?.country ?? null,
    userAgent: request.headers.get("user-agent"),
    origin: request.headers.get("origin"),
    patch,
  };
  await env.SUBMISSIONS.put(key, JSON.stringify(record, null, 2), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: {
      name: record.name.slice(0, 80),
      patch: patch.name.slice(0, 80),
    },
  });

  const patchName = clip(patch.name, LIMITS.notifyName);
  if (pushReady(env)) {
    ctx.waitUntil(
      broadcast(env, {
        title: "New gate pattern",
        body: `"${patchName}" from ${record.name} (${patch.nodes.length} nodes)`,
        url: "/admin",
        tag: "submission",
      }).catch((e: unknown) => console.error("Push broadcast failed:", e)),
    );
  }
  if (env.NOTIFY_WEBHOOK) {
    const line = `New gate pattern "${patchName}" from ${record.name} (${patch.nodes.length} nodes): ${key}`;
    ctx.waitUntil(
      fetch(env.NOTIFY_WEBHOOK, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Names are the sender's own text: Discord must not turn an
        // "@everyone" in one into a ping.
        body: JSON.stringify({
          content: line,
          text: line,
          allowed_mentions: { parse: [] },
        }),
      }).catch((e: unknown) => console.error("Notify webhook failed:", e)),
    );
  }
  return json(200, { ok: true, id });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/api/submit") {
      if (request.method !== "POST") {
        return json(405, { error: "POST a submission here." });
      }
      try {
        return await submit(request, env, ctx);
      } catch (e) {
        console.error("Submit failed:", e);
        return json(500, {
          error: "Something went wrong saving that. Try again later.",
        });
      }
    }
    if (url.pathname.startsWith("/api/notify/")) {
      try {
        return await notify(request, env, url);
      } catch (e) {
        console.error(`${url.pathname} failed:`, e);
        return json(500, { error: "Something went wrong. Try again later." });
      }
    }
    if (url.pathname === "/api/live") {
      if (request.method !== "GET") return json(405, { error: "GET it." });
      try {
        return await live(env);
      } catch (e) {
        console.error("Live check failed:", e);
        return json(200, { live: false });
      }
    }
    if (
      url.pathname === "/api/submissions" ||
      url.pathname.startsWith("/api/submissions/")
    ) {
      try {
        return await submissions(request, env, url);
      } catch (e) {
        console.error(`${url.pathname} failed:`, e);
        return json(500, { error: "Something went wrong. Try again later." });
      }
    }
    if (url.pathname.startsWith("/api/")) {
      return json(404, { error: "No such endpoint." });
    }
    return env.ASSETS.fetch(request);
  },
};
