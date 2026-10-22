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
        if (kind === "webgl2") {
          // As Firefox refuses it, with its reason.
          this.dispatchEvent(
            new WebGLContextEvent("webglcontextcreationerror", {
              statusMessage: "FEATURE_FAILURE_TEST_BLOCKLIST",
            }),
          );
          return null;
        }
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
    await expect(fields).toContainText(
      "WebGL2 refused: FEATURE_FAILURE_TEST_BLOCKLIST",
    );
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
      webgl: expect.stringContaining(
        "WebGL2 refused: FEATURE_FAILURE_TEST_BLOCKLIST",
      ),
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

test.describe("reporting a problem from a working playground", () => {
  test("the top bar offers it; the note is required; nothing is counted", async ({
    page,
  }) => {
    await recordCounts(page);
    const sent = await fakeReportBackend(page);
    await page.goto("/playground");
    await page
      .locator(".pg-bar")
      .getByRole("button", { name: "Report a problem" })
      .click();

    const dialog = page.getByRole("dialog", { name: "Report a problem" });
    await expect(dialog).toBeVisible();
    const fields = dialog.locator(".report-fields");
    await expect(fields).toContainText("Site version");
    // No error to show, so no "What went wrong" row.
    await expect(fields).not.toContainText("What went wrong");
    const send = dialog.getByRole("button", { name: "Send" });
    const note = dialog.getByLabel("What went wrong?");
    await expect(send).toBeDisabled();
    // Once the spam check has passed, only an empty note holds it back.
    await note.fill("The hue slider turns the gate green.");
    await expect(send).toBeEnabled();
    await note.fill("   ");
    await expect(send).toBeDisabled();
    await note.fill("The hue slider turns the gate green.");
    await send.click();
    await expect(dialog).toContainText("Thank you");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      code: "user-report",
      message: "",
      note: "The hue slider turns the gate green.",
      turnstile: "test-token",
    });
    // The pattern stays home unless asked for.
    expect(sent[0].patch).toBeUndefined();
    expect(await codesCounted(page)).not.toContain("user-report");
  });

  test("includes the pattern only when its box is ticked, saying what it holds", async ({
    page,
  }) => {
    const sent = await fakeReportBackend(page);
    await page.goto("/playground");
    await page
      .locator(".pg-bar")
      .getByRole("button", { name: "Report a problem" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Report a problem" });
    const include = dialog.getByRole("checkbox", {
      name: /Include my pattern/,
    });
    await expect(include).not.toBeChecked();
    await expect(dialog.getByText(/Include my pattern/)).toContainText(
      /“.+”: \d+ nodes?, \d+ KB/,
    );
    await include.check();
    await dialog.getByLabel("What went wrong?").fill("Wrong colours.");
    await dialog.getByRole("button", { name: "Send" }).click();
    await expect(dialog).toContainText("Thank you");
    const patch = sent[0].patch as unknown as {
      name: string;
      nodes: unknown[];
    };
    expect(patch.nodes.length).toBeGreaterThan(0);
    expect(typeof patch.name).toBe("string");
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

test.describe("unexpected errors", () => {
  /** Serve one of the build's chunks with `extra` appended: code that runs
   * as part of that script, as if the bug were in it. */
  async function plant(page: Page, chunk: string, extra: string) {
    await page.route(`**/assets/${chunk}-*.js`, async (route) => {
      const res = await route.fetch();
      await route.fulfill({
        response: res,
        body: `${await res.text()}\n${extra}`,
      });
    });
  }

  /** Runs `then` (source) once the page has hydrated, from the chunk. */
  const afterHydration = (then: string) =>
    `const __t = setInterval(() => {
      if (!document.documentElement.hasAttribute("data-hydrated")) return;
      clearInterval(__t);
      setTimeout(() => { ${then} }, 0);
    }, 20);`;

  test.beforeEach(async ({ page }) => {
    await recordCounts(page);
    await page.route("**/api/live", (route) =>
      route.fulfill({ json: { live: false } }),
    );
  });

  test("an error thrown by the site's own script is counted, by script", async ({
    page,
  }) => {
    await plant(page, "privacy", afterHydration(`throw new Error("planted");`));
    await page.goto("/privacy");
    await expect
      .poll(() => counts(page))
      .toContainEqual(
        expect.objectContaining({ code: "uncaught", where: "privacy" }),
      );
    // Never the error's text.
    expect(JSON.stringify(await counts(page))).not.toContain("planted");
  });

  test("so is an unhandled rejection", async ({ page }) => {
    await plant(
      page,
      "privacy",
      afterHydration(`Promise.reject(new Error("planted rejection"));`),
    );
    await page.goto("/privacy");
    await expect
      .poll(() => counts(page))
      .toContainEqual(
        expect.objectContaining({ code: "uncaught", where: "privacy" }),
      );
  });

  test("errors from code that isn't the site's are not counted", async ({
    page,
  }) => {
    await page.goto("/privacy");
    await expect(page.locator("html")).toHaveAttribute("data-hydrated", "");
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error("from elsewhere");
      }, 0);
      void Promise.reject(new Error("also from elsewhere"));
    });
    // Give both a moment to reach the handlers.
    await page.waitForTimeout(300);
    expect(await codesCounted(page)).toEqual([]);
  });

  test("a page that crashes while rendering says so, counts it, offers a report", async ({
    page,
  }) => {
    await page.route("**/assets/privacy-*.js", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: `export const meta = () => [];
export default function Privacy() { throw new Error("planted render error"); }`,
      }),
    );
    await page.goto("/privacy");
    await expect(
      page.getByRole("heading", { name: "Something went wrong." }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send a report" }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-hydrated", "");
    await expect
      .poll(() => counts(page))
      .toContainEqual(
        expect.objectContaining({ code: "uncaught", where: "privacy" }),
      );
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
