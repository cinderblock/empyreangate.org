import { describe, expect, test } from "bun:test";
import worker, { checkSubmission, LIMITS, type Env } from "./index";

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
  const puts: { key: string; value: string }[] = [];
  const e: Env = {
    ASSETS: { fetch: async () => new Response("asset") },
    SUBMISSIONS: {
      put: async (key: string, value: string) => {
        puts.push({ key, value });
      },
      // Lists what this test stored under the prefix, like the real bucket.
      list: async ({ prefix, limit = 1000 }) => {
        const all = puts.filter((p) => p.key.startsWith(prefix));
        return { objects: all.slice(0, limit), truncated: all.length > limit };
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
        /^submissions\/\d{4}-\d\d-\d\d\/\d+-[0-9a-f-]+\.json$/,
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
