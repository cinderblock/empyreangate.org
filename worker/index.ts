/**
 * The site's only server code: `POST /api/submit`, the playground's Submit.
 * Everything else is the prerendered static site, served from assets without
 * waking this Worker (`assets.run_worker_first` in wrangler.jsonc covers
 * `/api/*` only).
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

function authorized(request: Request, env: PushEnv): boolean {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return token.length > 0 && sameSecret(token, env.ADMIN_TOKEN);
}

async function subscriptionKey(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", te.encode(endpoint));
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${NOTIFY_PREFIX}${hex.slice(0, 32)}.json`;
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
    } catch {
      // A push service that is down loses one message; the next one tries again.
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

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
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
  // Cheapest check first: a visitor sending more than a few a minute is a
  // script, and this costs nothing (no body read, no R2 call).
  if (env.SUBMIT_LIMIT && ip) {
    const { success } = await env.SUBMIT_LIMIT.limit({ key: ip });
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
  // The daily cap: one list of today's prefix, after the spam check so bots
  // cannot spend it. Full means we have all we can look at for one day.
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
  const key = `submissions/${day}/${now.getTime()}-${id}.json`;
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

  if (pushReady(env)) {
    ctx.waitUntil(
      broadcast(env, {
        title: "New gate pattern",
        body: `"${patch.name}" from ${record.name} (${patch.nodes.length} nodes)`,
        url: "/admin",
        tag: "submission",
      }).catch(() => undefined),
    );
  }
  if (env.NOTIFY_WEBHOOK) {
    const line = `New gate pattern "${patch.name}" from ${record.name} (${patch.nodes.length} nodes): ${key}`;
    ctx.waitUntil(
      fetch(env.NOTIFY_WEBHOOK, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: line, text: line }),
      }).catch(() => undefined),
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
      } catch {
        return json(500, {
          error: "Something went wrong saving that. Try again later.",
        });
      }
    }
    if (url.pathname.startsWith("/api/notify/")) {
      try {
        return await notify(request, env, url);
      } catch {
        return json(500, { error: "Something went wrong. Try again later." });
      }
    }
    if (url.pathname.startsWith("/api/")) {
      return json(404, { error: "No such endpoint." });
    }
    return env.ASSETS.fetch(request);
  },
};
