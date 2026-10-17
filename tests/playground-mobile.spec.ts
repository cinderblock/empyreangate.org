import { expect, test } from "@playwright/test";

/**
 * The playground on a phone: stacked, the live gate docking at the top as
 * the page scrolls, the editor's side panels as sheets, and a one-time
 * "works best on a desktop" toast. Headless browsers may lack WebGPU; the
 * dock only exists when the preview renders, so those checks skip without it.
 */

const PHONE = { width: 393, height: 852 };
const DOCK_HEIGHT = 88; // 5.5rem at the default root size

test.describe("Pattern playground on a phone", () => {
  test.use({ viewport: PHONE, hasTouch: true });

  // Compact has no toolbar: the open patch shows as a chip on the canvas.
  const opened = (page: import("@playwright/test").Page) =>
    expect(page.locator(".patch-name-chip")).toContainText("Rainbow Sparkle", {
      timeout: 20_000,
    });

  test.beforeEach(async ({ page }) => {
    await page.goto("/playground");
    await opened(page);
    await expect(page.locator(".pg-stage")).toHaveAttribute(
      "data-preview",
      /^(running|unavailable)$/,
      { timeout: 20_000 },
    );
  });

  for (const width of [375, 393, 768]) {
    test(`fits ${width}px without horizontal scrolling`, async ({ page }) => {
      await page.setViewportSize({ width, height: 852 });
      await page.waitForTimeout(300);
      for (const y of [0, 400, 2000]) {
        await page.evaluate((y) => scrollTo(0, y), y);
        await page.waitForTimeout(150);
        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(overflow.scrollWidth, `at scrollY ${y}`).toBeLessThanOrEqual(
          overflow.clientWidth,
        );
      }
    });
  }

  test("says once that a desktop is the better tool", async ({ page }) => {
    const toast = page.locator(".pg-toast");
    await expect(toast).toContainText("Works best on a desktop");
    await toast.getByRole("button", { name: "Got it" }).click();
    await expect(toast).toHaveCount(0);
    await page.reload();
    await opened(page);
    await expect(page.locator(".pg-toast")).toHaveCount(0);
  });

  test("the gate docks at the top as the page scrolls, unless turned off", async ({
    page,
  }) => {
    const stage = page.locator(".pg-stage");
    test.skip(
      (await stage.getAttribute("data-preview")) !== "running",
      "no WebGPU in this browser: nothing to dock",
    );
    const gate = page.locator("canvas.pg-gate");
    await expect(stage).toHaveAttribute("data-dock", "on");
    const full = (await gate.boundingBox())!;
    expect(full.width).toBeCloseTo(PHONE.width, 0);

    // Part way: smaller, still touching the content below it.
    await page.evaluate(() => scrollTo({ top: 200, behavior: "instant" }));
    await expect
      .poll(async () => (await gate.boundingBox())!.width)
      .toBeLessThan(full.width);
    const mid = (await gate.boundingBox())!;
    expect(mid.width).toBeGreaterThan(DOCK_HEIGHT);
    const spacerBottom = await page
      .locator(".pg-dock-spacer")
      .evaluate((el) => el.getBoundingClientRect().bottom);
    expect(Math.abs(mid.y + mid.height - spacerBottom)).toBeLessThan(2);

    // Docked: a small square at the top, the controls beside it live, and
    // it stays there all the way down to the editor.
    await page.locator(".pg-editor").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await expect(stage).toHaveAttribute("data-dock", "docked");
    const docked = (await gate.boundingBox())!;
    expect(docked.y).toBeCloseTo(0, 0);
    expect(docked.height).toBeCloseTo(DOCK_HEIGHT, 0);
    await expect(
      page.locator(".pg-dock-right").getByLabel("Brightness"),
    ).toBeVisible();
    const editorTop = await page
      .locator(".pg-editor")
      .evaluate((el) => el.getBoundingClientRect().top);
    expect(editorTop).toBeCloseTo(DOCK_HEIGHT, 0);

    // Off: an ordinary element that scrolls away; remembered.
    await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    await page.getByLabel("Keep the gate in view while you scroll").uncheck();
    await expect(stage).toHaveAttribute("data-dock", "off");
    await page.evaluate(() => scrollTo({ top: 600, behavior: "instant" }));
    await expect
      .poll(async () => (await gate.boundingBox())!.y)
      .toBeLessThan(0);
    await page.reload();
    await opened(page);
    await expect(page.locator(".pg-stage")).toHaveAttribute("data-dock", "off");
  });

  test("the editor's palette and node settings are sheets", async ({
    page,
  }) => {
    // The one-time toast sits over the bottom of the screen; out of the way.
    await page.getByRole("button", { name: "Got it" }).click();
    await page.locator(".pg-editor").scrollIntoViewIfNeeded();
    await expect(page.locator(".patch-tab")).toHaveClass(/compact/);
    await expect(page.locator(".patch-palette")).toHaveCount(0);
    const before = await page.locator(".pnode").count();
    await page.getByRole("button", { name: "Add node" }).click();
    const palette = page.locator(".patch-palette.patch-sheet");
    await expect(palette).toBeVisible();
    await palette.locator(".palette-item", { hasText: "Plasma" }).click();
    await expect(palette).toHaveCount(0);
    await expect(page.locator(".pnode")).toHaveCount(before + 1);

    const node = page.locator(".pnode", { hasText: "Plasma" }).first();
    await node.click();
    await expect(page.locator(".patch-side")).toHaveCount(0);
    await page.getByRole("button", { name: "Plasma settings" }).click();
    const sheet = page.locator(".patch-side.patch-sheet");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(sheet).toHaveCount(0);
  });
});
