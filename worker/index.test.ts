import { describe, expect, test } from "bun:test";
import worker, {
  checkSubmission,
  deps,
  forgetLive,
  keyTime,
  LIMITS,
  visitorAddress,
  type Env,
  type SubmissionSummary,
} from "./index";
import { generateVapidKeys } from "./webpush";

const patch = {
  format: 1,
  id: "",
  name: "Test",
  description: "",
  nodes: [
    { id: "n1", kind: "rainbow", name: "", params: {}, pos: [0, 0] },
    { id: "n2", kind: "output", name: "", params: {}, pos: [300, 0] },
  ],
  edges: [
    { from: { node: "n1", port: "out" }, to: { node: "n2", port: "in" } },
  ],
  exposed: [],
};

function env(overrides: Partial<Env> = {}) {
  // A bucket in memory: `puts` is every object written (tests read it), kept
  // in order; get/list/delete behave like R2 over the same objects.
  const puts: { key: string; value: string }[] = [];
  const e: Env = {
    ASSETS: { fetch: async () => new Response("asset") },
    SUBMISSIONS: {
      put: async (key: string, value: string) => {
        const i = puts.findIndex((p) => p.key === key);
        if (i >= 0) puts[i] = { key, value };
        else puts.push({ key, value });
      },
      // Lists what this test stored under the prefix, like the real bucket.
      list: async ({ prefix, limit = 1000 }) => {
        const all = puts.filter((p) => p.key.startsWith(prefix));
        return { objects: all.slice(0, limit), truncated: all.length > limit };
      },
      get: async (key: string) => {
        const hit = puts.find((p) => p.key === key);
        return hit ? { text: async () => hit.value } : null;
      },
      delete: async (key: string) => {
        const i = puts.findIndex((p) => p.key === key);
        if (i >= 0) puts.splice(i, 1);
      },
    },
    SUBMIT_LIMIT: { limit: async () => ({ success: true }) },
    TURNSTILE_SECRET: "secret",
    ...overrides,
  };
  return { env: e, puts };
}

const ctx = { waitUntil: () => {} };

function post(body: unknown) {
  return new Request("https://empyreangate.org/api/submit", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const good = {
  patch,
  name: "Ada",
  contact: "",
  message: "",
  agreed: true,
  turnstile: "tok",
};

describe("checkSubmission", () => {
  test("needs a name and agreement", () => {
    expect(checkSubmission(good)).toBeNull();
    expect(checkSubmission({ ...good, name: " " })).toMatch(/name/);
    expect(checkSubmission({ ...good, agreed: false })).toMatch(/agree/);
    expect(checkSubmission({ ...good, message: "x".repeat(5000) })).toMatch(
      /long/,
    );
  });
});

describe("worker", () => {
  test("serves everything but /api from assets", async () => {
    const { env: e } = env();
    const res = await worker.fetch(
      new Request("https://empyreangate.org/playground"),
      e,
      ctx,
    );
    expect(await res.text()).toBe("asset");
  });

  test("is closed until the bucket and secret are bound", async () => {
    const { env: e } = env({ SUBMISSIONS: undefined });
    const res = await worker.fetch(post(good), e, ctx);
    expect(res.status).toBe(503);
  });

  test("stores a verified submission", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({ success: true })) as unknown as typeof fetch;
    try {
      const { env: e, puts } = env();
      const res = await worker.fetch(post(good), e, ctx);
      expect(res.status).toBe(200);
      expect(puts).toHaveLength(1);
      expect(puts[0].key).toMatch(
        /^submissions\/\d{4}-\d\d-\d\d\/[0-9a-f]{16}\/\d+-[0-9a-f-]+\.json$/,
      );
      const record = JSON.parse(puts[0].value);
      expect(record.name).toBe("Ada");
      expect(record.patch.nodes).toHaveLength(2);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("refuses a failed spam check, junk and oversized patches", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({ success: false })) as unknown as typeof fetch;
    try {
      const { env: e, puts } = env();
      expect((await worker.fetch(post(good), e, ctx)).status).toBe(403);
      expect(
        (await worker.fetch(post({ ...good, patch: { nope: 1 } }), e, ctx))
          .status,
      ).toBe(400);
      const huge = {
        ...patch,
        nodes: Array.from({ length: 300 }, (_, i) => ({
          ...patch.nodes[0],
          id: `n${i}`,
        })),
      };
      expect(
        (await worker.fetch(post({ ...good, patch: huge }), e, ctx)).status,
      ).toBe(400);
      expect(puts).toHaveLength(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("caps", () => {
  test("a visitor over the per-minute limit is told to wait, before anything is read", async () => {
    const { env: e, puts } = env({
      SUBMIT_LIMIT: { limit: async () => ({ success: false }) },
    });
    const req = post(good);
    req.headers.set("cf-connecting-ip", "203.0.113.9");
    const res = await worker.fetch(req, e, ctx);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toMatch(/minute/);
    expect(puts).toHaveLength(0);
  });

  test("the bucket takes LIMITS.perDay a day, then says come back tomorrow", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({ success: true })) as unknown as typeof fetch;
    try {
      const { env: e, puts } = env();
      const day = new Date().toISOString().slice(0, 10);
      for (let i = 0; i < LIMITS.perDay; i++) {
        puts.push({ key: `submissions/${day}/${i}-x.json`, value: "{}" });
      }
      const res = await worker.fetch(post(good), e, ctx);
      expect(res.status).toBe(429);
      expect(((await res.json()) as { error: string }).error).toMatch(
        /tomorrow/,
      );
      expect(puts).toHaveLength(LIMITS.perDay);
      // Yesterday's do not count against today.
      puts.length = 0;
      for (let i = 0; i < LIMITS.perDay; i++) {
        puts.push({ key: `submissions/2000-01-01/${i}-x.json`, value: "{}" });
      }
      expect((await worker.fetch(post(good), e, ctx)).status).toBe(200);
      expect(puts).toHaveLength(LIMITS.perDay + 1);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("visitors", () => {
  test("an IPv4 address is itself; an IPv6 address is its /64", () => {
    expect(visitorAddress("203.0.113.9")).toBe("203.0.113.9");
    expect(visitorAddress("2001:db8:0a:1::5")).toBe("2001:db8:a:1::/64");
    expect(visitorAddress("2001:DB8:a:1:ffff:2:3:4")).toBe("2001:db8:a:1::/64");
    expect(visitorAddress("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(visitorAddress("::1")).toBe("0:0:0:0::/64");
  });

  test("one visitor gets LIMITS.perVisitorPerDay a day; others still get in", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({ success: true })) as unknown as typeof fetch;
    try {
      const { env: e, puts } = env();
      const from = (ip: string) => {
        const req = post(good);
        req.headers.set("cf-connecting-ip", ip);
        return req;
      };
      for (let i = 0; i < LIMITS.perVisitorPerDay; i++) {
        expect((await worker.fetch(from("203.0.113.9"), e, ctx)).status).toBe(
          200,
        );
      }
      const res = await worker.fetch(from("203.0.113.9"), e, ctx);
      expect(res.status).toBe(429);
      expect(((await res.json()) as { error: string }).error).toMatch(
        /one person/,
      );
      // A new address in the same IPv6 /64 is the same visitor.
      for (let i = 0; i < LIMITS.perVisitorPerDay; i++) {
        await worker.fetch(from(`2001:db8:0:1::${i + 1}`), e, ctx);
      }
      expect(
        (await worker.fetch(from("2001:db8:0:1::ff"), e, ctx)).status,
      ).toBe(429);
      expect((await worker.fetch(from("198.51.100.4"), e, ctx)).status).toBe(
        200,
      );
      // The bucket never holds the address itself.
      for (const p of puts) {
        expect(p.key.split("/")[2]).toMatch(/^[0-9a-f]{16}$/);
        expect(p.key).not.toMatch(/203\.0\.113|2001:db8|198\.51\.100/);
      }
      expect(puts).toHaveLength(2 * LIMITS.perVisitorPerDay + 1);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("the notify webhook", () => {
  test("clips a long patch name and lets no mention ping anyone", async () => {
    const realFetch = globalThis.fetch;
    const sent: { content: string; allowed_mentions: unknown }[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (String(url).includes("turnstile"))
        return Response.json({ success: true });
      sent.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    try {
      const { env: e } = env({ NOTIFY_WEBHOOK: "https://hooks.example/x" });
      const long = { ...patch, name: "@everyone ".repeat(500) };
      const res = await worker.fetch(post({ ...good, patch: long }), e, ctx);
      expect(res.status).toBe(200);
      expect(sent).toHaveLength(1);
      expect(sent[0].content.length).toBeLessThan(300);
      expect(sent[0].content).toContain("…");
      expect(sent[0].allowed_mentions).toEqual({ parse: [] });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("crew notifications", () => {
  const subscription = {
    endpoint: "https://push.example/send/device-1",
    keys: {
      // A real P-256 point and 16-byte auth secret are only needed to send;
      // storing checks shape alone.
      p256dh: "BH" + "A".repeat(85),
      auth: "A".repeat(22),
    },
  };
  async function pushEnv(overrides: Partial<Env> = {}) {
    const keys = await generateVapidKeys();
    return env({
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
      ADMIN_TOKEN: "letmein",
      ...overrides,
    });
  }
  function call(path: string, init: RequestInit & { token?: string } = {}) {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    return new Request(`https://empyreangate.org${path}`, { ...init, headers });
  }

  test("the key is public once set up; everything else needs the admin token", async () => {
    const { env: e } = env();
    expect((await worker.fetch(call("/api/notify/key"), e, ctx)).status).toBe(
      503,
    );
    const { env: p } = await pushEnv();
    const key = await worker.fetch(call("/api/notify/key"), p, ctx);
    expect(key.status).toBe(200);
    expect(((await key.json()) as { key: string }).key).toBe(
      p.VAPID_PUBLIC_KEY!,
    );
    const body = JSON.stringify({ subscription });
    expect(
      (
        await worker.fetch(
          call("/api/notify/subscribe", { method: "POST", body }),
          p,
          ctx,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await worker.fetch(
          call("/api/notify/subscribe", {
            method: "POST",
            body,
            token: "wrong",
          }),
          p,
          ctx,
        )
      ).status,
    ).toBe(401);
  });

  test("subscribe stores the device under notify/, and DELETE removes it", async () => {
    const { env: p, puts } = await pushEnv();
    const bad = await worker.fetch(
      call("/api/notify/subscribe", {
        method: "POST",
        body: JSON.stringify({ subscription: { endpoint: "http://x" } }),
        token: "letmein",
      }),
      p,
      ctx,
    );
    expect(bad.status).toBe(400);
    const ok = await worker.fetch(
      call("/api/notify/subscribe", {
        method: "POST",
        body: JSON.stringify({ subscription, label: "Ada's phone" }),
        token: "letmein",
      }),
      p,
      ctx,
    );
    expect(ok.status).toBe(200);
    expect(puts).toHaveLength(1);
    expect(puts[0].key).toMatch(/^notify\/[0-9a-f]{32}\.json$/);
    expect(JSON.parse(puts[0].value).label).toBe("Ada's phone");
    // Subscribing the same endpoint again replaces, not duplicates.
    await worker.fetch(
      call("/api/notify/subscribe", {
        method: "POST",
        body: JSON.stringify({ subscription }),
        token: "letmein",
      }),
      p,
      ctx,
    );
    expect(puts).toHaveLength(1);
    const gone = await worker.fetch(
      call("/api/notify/subscribe", {
        method: "DELETE",
        body: JSON.stringify({ endpoint: subscription.endpoint }),
        token: "letmein",
      }),
      p,
      ctx,
    );
    expect(gone.status).toBe(200);
    expect(puts).toHaveLength(0);
  });

  test("a submission pushes to every device; devices the push service reports gone are dropped", async () => {
    const realFetch = globalThis.fetch;
    const realPush = deps.fetch;
    globalThis.fetch = (async () =>
      Response.json({ success: true })) as unknown as typeof fetch;
    const pushed: string[] = [];
    deps.fetch = async (input) => {
      const url = String(input);
      pushed.push(url);
      return new Response(null, { status: url.endsWith("gone") ? 410 : 201 });
    };
    try {
      const { env: p, puts } = await pushEnv();
      // Two real-looking subscriptions (the keys must be valid points to
      // encrypt for), one of them stale.
      const pair = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveBits"],
      );
      const raw = new Uint8Array(
        await crypto.subtle.exportKey("raw", pair.publicKey),
      );
      const b64 = (b: Uint8Array) =>
        btoa(String.fromCharCode(...b))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
      const keys = {
        p256dh: b64(raw),
        auth: b64(crypto.getRandomValues(new Uint8Array(16))),
      };
      for (const endpoint of [
        "https://push.example/send/live",
        "https://push.example/send/gone",
      ]) {
        await worker.fetch(
          call("/api/notify/subscribe", {
            method: "POST",
            body: JSON.stringify({ subscription: { endpoint, keys } }),
            token: "letmein",
          }),
          p,
          ctx,
        );
      }
      expect(puts.filter((x) => x.key.startsWith("notify/"))).toHaveLength(2);

      const waits: Promise<unknown>[] = [];
      const res = await worker.fetch(post(good), p, {
        waitUntil: (w: Promise<unknown>) => waits.push(w),
      });
      expect(res.status).toBe(200);
      await Promise.all(waits);
      expect(pushed.sort()).toEqual([
        "https://push.example/send/gone",
        "https://push.example/send/live",
      ]);
      expect(puts.filter((x) => x.key.startsWith("notify/"))).toHaveLength(1);

      // The test button reports how many devices accepted.
      pushed.length = 0;
      const t = await worker.fetch(
        call("/api/notify/test", {
          method: "POST",
          body: "{}",
          token: "letmein",
        }),
        p,
        ctx,
      );
      expect(((await t.json()) as { sent: number }).sent).toBe(1);
    } finally {
      globalThis.fetch = realFetch;
      deps.fetch = realPush;
    }
  });
});

describe("the gate, live", () => {
  function get(path: string) {
    return new Request(`https://empyreangate.org${path}`);
  }
  test("without a floor URL nothing is ever live", async () => {
    forgetLive();
    const res = await worker.fetch(get("/api/live"), env().env, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ live: false });
  });

  test("a floor that answers is live, with what it says is on", async () => {
    forgetLive();
    const realFetch = deps.fetch;
    const asked: string[] = [];
    deps.fetch = async (input) => {
      asked.push(String(input));
      return Response.json({
        ok: true,
        open: true,
        players: 3,
        game: null,
        now_playing: { name: "Ember Drift", credit: "Ada" },
      });
    };
    try {
      const e = env({ LIVE_URL: "https://play.example.org/" }).env;
      const res = await worker.fetch(get("/api/live"), e, ctx);
      expect(res.headers.get("cache-control")).toBe("public, max-age=10");
      expect(await res.json()).toEqual({
        live: true,
        url: "https://play.example.org",
        open: true,
        players: 3,
        game: null,
        nowPlaying: { name: "Ember Drift", credit: "Ada" },
      });
      expect(asked).toEqual(["https://play.example.org/health"]);
      // Asked again inside the memo window: the floor is not.
      await worker.fetch(get("/api/live"), e, ctx);
      expect(asked).toHaveLength(1);
    } finally {
      deps.fetch = realFetch;
    }
  });

  test("a floor that is down, or an older one answering 204, is handled", async () => {
    const realFetch = deps.fetch;
    try {
      forgetLive();
      deps.fetch = async () => {
        throw new TypeError("fetch failed");
      };
      const e = env({ LIVE_URL: "https://play.example.org" }).env;
      expect(
        await (await worker.fetch(get("/api/live"), e, ctx)).json(),
      ).toEqual({
        live: false,
      });
      forgetLive();
      deps.fetch = async () => new Response(null, { status: 204 });
      expect(
        await (await worker.fetch(get("/api/live"), e, ctx)).json(),
      ).toEqual({
        live: true,
        url: "https://play.example.org",
      });
    } finally {
      deps.fetch = realFetch;
    }
  });
});

describe("the queue", () => {
  function call(path: string, init: RequestInit & { token?: string } = {}) {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    return new Request(`https://empyreangate.org${path}`, { ...init, headers });
  }
  async function queued(overrides: Partial<Env> = {}) {
    const made = env({ ADMIN_TOKEN: "letmein", ...overrides });
    const bucket = made.env.SUBMISSIONS!;
    const record = (id: string, name: string, patchName: string) =>
      JSON.stringify({
        id,
        submittedAt: "2026-10-17T08:02:00.000Z",
        name,
        contact: "",
        message: `note from ${name}`,
        agreed: true,
        country: "US",
        patch: { ...patch, name: patchName },
      });
    await bucket.put(
      "submissions/2026-10-16/aaaa/1760600000000-older.json",
      record("older", "Grace", "Night Tide"),
    );
    await bucket.put(
      "submissions/2026-10-17/bbbb/1760700000000-newer.json",
      record("newer", "Ada", "Ember Drift"),
    );
    // Not part of the queue: the crew's push subscriptions share the bucket.
    await bucket.put("notify/device.json", "{}");
    return made;
  }

  test("keys sort by the time they were written", () => {
    expect(keyTime("submissions/2026-10-17/bbbb/1760700000000-x.json")).toBe(
      1760700000000,
    );
    expect(keyTime("junk")).toBe(0);
  });

  test("needs the admin token, and is closed until it exists", async () => {
    const closed = env().env;
    expect(
      (await worker.fetch(call("/api/submissions"), closed, ctx)).status,
    ).toBe(503);
    const { env: e } = await queued();
    expect((await worker.fetch(call("/api/submissions"), e, ctx)).status).toBe(
      401,
    );
    expect(
      (await worker.fetch(call("/api/submissions", { token: "nope" }), e, ctx))
        .status,
    ).toBe(401);
  });

  test("lists the queue newest first, one record on request", async () => {
    const { env: e } = await queued();
    const res = await worker.fetch(
      call("/api/submissions", { token: "letmein" }),
      e,
      ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      submissions: SubmissionSummary[];
      truncated: boolean;
    };
    expect(body.truncated).toBe(false);
    expect(body.submissions.map((s) => s.patch.name)).toEqual([
      "Ember Drift",
      "Night Tide",
    ]);
    expect(body.submissions[0]).toMatchObject({
      key: "submissions/2026-10-17/bbbb/1760700000000-newer.json",
      id: "newer",
      name: "Ada",
      message: "note from Ada",
      country: "US",
      patch: { name: "Ember Drift", nodes: 2, edges: 1 },
    });
    expect("nodes" in body.submissions[0].patch).toBe(true);
    expect(JSON.stringify(body)).not.toContain('"kind"');

    const one = await worker.fetch(
      call(
        `/api/submissions?key=${encodeURIComponent(body.submissions[0].key)}`,
        { token: "letmein" },
      ),
      e,
      ctx,
    );
    expect(one.status).toBe(200);
    const { submission } = (await one.json()) as {
      submission: { key: string; name: string; patch: typeof patch };
    };
    expect(submission.name).toBe("Ada");
    expect(submission.patch.nodes).toHaveLength(2);

    for (const bad of ["notify/device.json", "submissions/../x.json", "x"]) {
      const res = await worker.fetch(
        call(`/api/submissions?key=${encodeURIComponent(bad)}`, {
          token: "letmein",
        }),
        e,
        ctx,
      );
      expect(res.status).toBe(400);
    }
  });

  test("a decision moves the record under reviewed/ and out of the queue", async () => {
    const { env: e, puts } = await queued();
    const key = "submissions/2026-10-16/aaaa/1760600000000-older.json";
    const res = await worker.fetch(
      call("/api/submissions/decide", {
        method: "POST",
        token: "letmein",
        body: JSON.stringify({ key, decision: "used" }),
      }),
      e,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      key: "reviewed/used/2026-10-16/aaaa/1760600000000-older.json",
    });
    expect(puts.map((p) => p.key)).not.toContain(key);
    const moved = puts.find((p) => p.key.startsWith("reviewed/used/"))!;
    expect(JSON.parse(moved.value)).toMatchObject({
      id: "older",
      decision: "used",
    });
    const list = (await (
      await worker.fetch(call("/api/submissions", { token: "letmein" }), e, ctx)
    ).json()) as { submissions: SubmissionSummary[] };
    expect(list.submissions.map((s) => s.id)).toEqual(["newer"]);

    for (const body of [
      { key, decision: "used" },
      { key: "reviewed/used/x.json", decision: "used" },
      {
        key: "submissions/2026-10-17/bbbb/1760700000000-newer.json",
        decision: "maybe",
      },
    ]) {
      const res = await worker.fetch(
        call("/api/submissions/decide", {
          method: "POST",
          token: "letmein",
          body: JSON.stringify(body),
        }),
        e,
        ctx,
      );
      expect([400, 404]).toContain(res.status);
    }
  });
});
