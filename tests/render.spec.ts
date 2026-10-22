import { expect, test } from "@playwright/test";

/**
 * The live render. Headless browsers get WebGL2 through a software
 * rasteriser, so this normally reaches "running"; where it genuinely can't,
 * the page must still look intentional, with the still ring and a note.
 */
test.describe("Gate render", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("reaches a live state, or falls back on purpose", async ({ page }) => {
    const render = page.locator(".gate-render");
    await expect(render).toHaveAttribute(
      "data-render-state",
      /^(running|paused|fallback)$/,
      { timeout: 10_000 },
    );
    const state = await render.getAttribute("data-render-state");
    if (state === "fallback") {
      await expect(page.locator(".gate-still")).toBeVisible();
      await expect(page.getByText(/can't run the live render/)).toBeVisible();
    } else {
      await expect(page.locator(".gate-canvas")).toBeVisible();
      const size = await page.locator(".gate-canvas").evaluate((c) => {
        const el = c as HTMLCanvasElement;
        return { w: el.width, h: el.height };
      });
      // The drawing buffer was sized to the element, not left at 300x150.
      expect(size.w).toBeGreaterThan(200);
      expect(size.w).toBe(size.h);
    }
  });

  test("the still ring draws every spoke", async ({ page }) => {
    // Rasterise the still SVG and list spokes with no paint at mid-radius.
    const result = await page.evaluate(async () => {
      const svg = document.querySelector<SVGSVGElement>(".gate-still")!;
      const spokes = svg.querySelectorAll("line").length;
      const xml = new XMLSerializer().serializeToString(svg);
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
      await img.decode();
      const size = 400;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, size, size);
      const blank: number[] = [];
      for (let s = 0; s < spokes; s++) {
        const a = (s / spokes) * Math.PI * 2;
        // Halfway along the spoke, in viewBox units (-100..100).
        const r = 60;
        const x = Math.round(((Math.sin(a) * r + 100) / 200) * size);
        const y = Math.round(((-Math.cos(a) * r + 100) / 200) * size);
        const px = ctx.getImageData(x - 1, y - 1, 3, 3).data;
        let alpha = 0;
        for (let i = 3; i < px.length; i += 4) alpha = Math.max(alpha, px[i]);
        if (alpha === 0) blank.push(s);
      }
      return { spokes, blank };
    });
    expect(result).toEqual({ spokes: 64, blank: [] });
  });

  test("scene chips are exclusive toggles", async ({ page }) => {
    const chips = page
      .getByRole("group", { name: "Light scenes" })
      .locator(".chip-scene");
    await expect(chips).toHaveCount(5);
    await expect(chips.nth(0)).toHaveAttribute("aria-pressed", "true");
    const state = await page
      .locator(".gate-render")
      .getAttribute("data-render-state");
    test.skip(state === "fallback", "chips are disabled without WebGL");
    await chips.nth(2).click();
    await expect(chips.nth(2)).toHaveAttribute("aria-pressed", "true");
    await expect(chips.nth(0)).toHaveAttribute("aria-pressed", "false");
  });

  test("pause stops the animation and play resumes it", async ({ page }) => {
    const render = page.locator(".gate-render");
    await expect(render).toHaveAttribute(
      "data-render-state",
      /running|paused|fallback/,
      {
        timeout: 10_000,
      },
    );
    const state = await render.getAttribute("data-render-state");
    test.skip(state !== "running", "needs a running render");
    await page.getByRole("button", { name: "Pause animation" }).click();
    await expect(render).toHaveAttribute("data-render-state", "paused");
    await page.getByRole("button", { name: "Play animation" }).click();
    await expect(render).toHaveAttribute("data-render-state", "running");
  });

  test("pause sits on the animation, apart from the scene chips", async ({
    page,
  }) => {
    const render = page.locator(".gate-render");
    await expect(render).toHaveAttribute(
      "data-render-state",
      /running|paused|fallback/,
      { timeout: 10_000 },
    );
    const state = await render.getAttribute("data-render-state");
    test.skip(state === "fallback", "no pause control without WebGL");
    const button = page.getByRole("button", { name: /animation$/ });
    await expect(button).toHaveCount(1);
    await expect(page.locator(".gate-stage .gate-playpause")).toHaveCount(1);
    await expect(
      page.getByRole("group", { name: "Light scenes" }).getByRole("button", {
        name: /pause|play/i,
      }),
    ).toHaveCount(0);
  });

  test("respects prefers-reduced-motion by starting paused", async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/");
    const render = page.locator(".gate-render");
    await expect(render).toHaveAttribute(
      "data-render-state",
      /paused|fallback/,
      {
        timeout: 10_000,
      },
    );
    await context.close();
  });

  test("the canvas has an accessible description", async ({ page }) => {
    const canvas = page.locator(".gate-canvas");
    const name = await canvas.evaluate((c) => {
      const id = c.getAttribute("aria-labelledby")!;
      return document.getElementById(id)?.textContent ?? "";
    });
    expect(name).toMatch(/sixty-four spokes/i);
  });
});
