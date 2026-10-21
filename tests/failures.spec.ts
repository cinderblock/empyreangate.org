import { expect, test, type Page } from "@playwright/test";

/**
 * Failure counts and "Send a report" (app/failures.ts, app/watchdog.ts,
 * components/ReportProblem.tsx). `vite preview` has no Worker, so every
 * test answers `/api/*` itself, and Turnstile is a stand-in that passes at
 * once.
 *
 * Beacons are recorded in the page rather than caught on the network:
 * not every browser lets Playwright route a `sendBeacon`.
 */

/** Record every beacon and fetch to /api/failure, before any page script. */
async function recordCounts(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __counts: string[] };
    w.__counts = [];
    const send = navigator.sendBeacon?.bind(navigator);
    navigator.sendBeacon = (url, data) => {
      if (String(url).endsWith("/api/failure")) w.__counts.push(String(data));
      return send ? send(url, data) : false;
    };
  });
  await page.route("**/api/failure", (route) => route.fulfill({ status: 204 }));
}

async function counts(page: Page): Promise<{ code: string; build: string }[]> {
  const raw = await page.evaluate(
    () => (window as unknown as { __counts: string[] }).__counts,
  );
  return raw.map((s) => JSON.parse(s));
}

async function codesCounted(page: Page): Promise<string[]> {
  return (await counts(page)).map((c) => c.code);
}

/** Turnstile that passes straight away, and an /api/report that records. */
async function fakeReportBackend(page: Page) {
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.turnstile = {
        render(el, o) { setTimeout(() => o.callback("test-token"), 0); return "w1"; },
        reset() {},
        remove() {},
      };`,
    }),
  );
  const sent: Record<string, string>[] = [];
  await page.route("**/api/report", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true, id: "x" } });
  });
  await page.route("**/api/live", (route) =>
    route.fulfill({ json: { live: false } }),
  );
  return sent;
}

test.describe("home page without WebGL2", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        kind: string,
        ...rest: unknown[]
      ) {
        if (kind === "webgl2") return null;
        return (get as (...a: unknown[]) => RenderingContext | null).call(
          this,
          kind,
          ...rest,
        );
      } as typeof get;
    });
    await recordCounts(page);
  });

  test("counts the failure: its code and the build, nothing else", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator(".gate-render")).toHaveAttribute(
      "data-render-state",
      "fallback",
    );
    await expect.poll(() => codesCounted(page)).toEqual(["render-webgl"]);
    const [count] = await counts(page);
    expect(Object.keys(count).sort()).toEqual(["build", "code"]);
    expect(count.build).toMatch(/^(?:[0-9a-f]{7,40}|local)$/);
  });

  test("sends a report only after showing it", async ({ page }) => {
    const sent = await fakeReportBackend(page);
    await page.goto("/");
    const button = page
      .locator(".gate-note")
      .getByRole("button", { name: "Send a report" });
    await button.click();

    const dialog = page.getByRole("dialog", { name: "Send a report" });
    await expect(dialog).toBeVisible();
    const fields = dialog.locator(".report-fields");
    await expect(fields).toContainText("What went wrong");
    await expect(fields).toContainText("no WebGL2 context");
    const ua = await page.evaluate(() => navigator.userAgent);
    await expect(fields).toContainText(ua);
    expect(sent).toHaveLength(0);

    await dialog.getByLabel("Anything to add?").fill("Old laptop.");
    const send = dialog.getByRole("button", { name: "Send" });
    await expect(send).toBeEnabled();
    await send.click();
    await expect(dialog).toContainText("Thank you");

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      code: "render-webgl",
      page: "/",
      browser: ua,
      note: "Old laptop.",
      contact: "",
      turnstile: "test-token",
    });
  });
});

test.describe("playground without WebGPU", () => {
  test("counts it, and offers a report beside the explanation", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "gpu", {
        get: () => undefined,
        configurable: true,
      });
    });
    await recordCounts(page);
    const sent = await fakeReportBackend(page);
    await page.goto("/playground");
    await expect(page.locator(".pg-stage")).toHaveAttribute(
      "data-preview",
      "unavailable",
    );
    await expect.poll(() => codesCounted(page)).toEqual(["webgpu-unavailable"]);

    await page
      .locator(".pg-nogpu")
      .getByRole("button", { name: "Send a report" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Send a report" });
    await expect(dialog.locator(".report-fields")).toContainText(
      "Not available (no navigator.gpu)",
    );
    await dialog.getByRole("button", { name: "Send" }).click();
    await expect(dialog).toContainText("Thank you");
    expect(sent[0]).toMatchObject({
      code: "webgpu-unavailable",
      // Their own patch is open; its id stays out of the report.
      page: expect.stringMatching(/^\/playground\/(?:p\/…)?$/),
    });
  });
});

test.describe("the playground's code doesn't load", () => {
  test("says so, with Reload and a report, and counts it", async ({ page }) => {
    await recordCounts(page);
    await page.route("**/assets/Playground-*.js", (route) =>
      route.fulfill({ status: 404, body: "" }),
    );
    await page.route("**/api/live", (route) =>
      route.fulfill({ json: { live: false } }),
    );
    await page.goto("/playground");
    await expect(page.getByText("The playground didn't load.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send a report" }),
    ).toBeVisible();
    await expect.poll(() => codesCounted(page)).toContain("playground-load");
  });
});

test.describe("watchdog", () => {
  test("counts a build script that fails to load", async ({ page }) => {
    await recordCounts(page);
    await page.route("**/assets/manifest-*.js", (route) =>
      route.fulfill({ status: 404, body: "" }),
    );
    await page.goto("/");
    await expect.poll(() => codesCounted(page)).toContain("asset-load");
    // React never started, so nothing else could have said so.
    await expect(page.locator("html")).not.toHaveAttribute("data-hydrated");
  });

  test("a healthy page is marked hydrated and counts nothing", async ({
    page,
  }) => {
    await recordCounts(page);
    await page.route("**/api/live", (route) =>
      route.fulfill({ json: { live: false } }),
    );
    await page.goto("/privacy");
    await expect(page.locator("html")).toHaveAttribute("data-hydrated", "");
    expect(await codesCounted(page)).toEqual([]);
  });
});

test.describe("privacy page", () => {
  test("is linked from the home page's footer", async ({ page }) => {
    await page.route("**/api/live", (route) =>
      route.fulfill({ json: { live: false } }),
    );
    await page.goto("/");
    await page
      .locator(".site-footer")
      .getByRole("link", { name: "Privacy" })
      .click();
    await expect(page).toHaveURL(/\/privacy\/?$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "What this site learns about you",
    );
    await expect(page.getByText("When something breaks")).toBeVisible();
  });
});
