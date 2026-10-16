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
  }): Promise<{ objects: unknown[]; truncated: boolean }>;
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
}

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
    if (url.pathname.startsWith("/api/")) {
      return json(404, { error: "No such endpoint." });
    }
    return env.ASSETS.fetch(request);
  },
};
