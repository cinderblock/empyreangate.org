import { expect, test, type Page } from "@playwright/test";

/**
 * Every place in the playground has a URL (app/playground/urls.ts): a patch
 * in the library, a built-in, a Sub-patch inside either. A reload reopens
 * it, and Back/Forward move between them (Cameron, 2026-10-18).
 */

const UUID_URL = /\/playground\/p\/[0-9a-f-]{36}$/;

async function loaded(page: Page) {
  await expect(page.locator(".patch-name")).not.toHaveValue("", {
    timeout: 20_000,
  });
}

async function openBuiltin(page: Page, name: string) {
  await page.getByRole("button", { name: "📁 Patches" }).click();
  await page
    .locator(".patch-browser-panel .browser-item", { hasText: name })
    .first()
    .click();
  await expect(page.locator(".patch-name")).toHaveValue(name);
}

test.describe("Playground navigation", () => {
  test("the open patch is in the URL, and a reload reopens it", async ({
    page,
  }) => {
    await page.goto("/playground");
    await loaded(page);
    await expect(page.locator(".patch-name")).toHaveValue("Rainbow Sparkle");
    await expect(page).toHaveURL(UUID_URL);
    const url = page.url();
    await page.reload();
    await loaded(page);
    await expect(page).toHaveURL(url);
    await expect(page.locator(".patch-name")).toHaveValue("Rainbow Sparkle");
  });

  test("Back and Forward move between patches", async ({ page }) => {
    await page.goto("/playground");
    await loaded(page);
    await expect(page).toHaveURL(UUID_URL);
    const mine = page.url();

    await openBuiltin(page, "Scope");
    await expect(page).toHaveURL(/\/playground\/builtin\/scope$/);
    await expect(page.locator(".patch-lock-chip")).toHaveText(/Built-in/);

    await page.goBack();
    await expect(page).toHaveURL(mine);
    await expect(page.locator(".patch-name")).toHaveValue("Rainbow Sparkle");
    await expect(page.locator(".patch-lock-chip")).toHaveCount(0);

    await page.goForward();
    await expect(page).toHaveURL(/\/playground\/builtin\/scope$/);
    await expect(page.locator(".patch-name")).toHaveValue("Scope");
  });

  test("a built-in's URL opens it read-only; its copy gets its own URL", async ({
    page,
  }) => {
    await page.goto("/playground/builtin/noise-garden");
    await expect(page.locator(".patch-name")).toHaveValue("Noise Garden", {
      timeout: 20_000,
    });
    await page.locator(".patch-lock-chip").click();
    await page.getByRole("button", { name: "Make a copy to edit" }).click();
    // The copy replaces the built-in's step: Back leaves the playground's
    // history rather than returning to the read-only original.
    await expect(page).toHaveURL(UUID_URL);
    await expect(page.locator(".patch-lock-chip")).toHaveCount(0);
  });

  test("a double-clicked Sub-patch has a URL; Back comes out of it", async ({
    page,
  }) => {
    await page.goto("/playground");
    await loaded(page);
    await expect(page).toHaveURL(UUID_URL);
    const outer = page.url();
    await page.locator(".palette-sub", { hasText: "Scope" }).click();
    const sub = page.locator(".pnode", { hasText: "Sub-patch" });
    await expect(sub).toBeVisible();

    // Near its corner: the first click opens the side panel, which may cover
    // the middle of a node near the canvas edge.
    await sub.dblclick({ position: { x: 12, y: 12 } });
    await expect(page).toHaveURL(new RegExp(`${outer}/n\\d+$`));
    await expect(page.locator(".patch-crumbs .patch-crumb")).toHaveText([
      "Rainbow Sparkle ›",
      "Scope",
    ]);
    const inside = page.url();

    await page.goBack();
    await expect(page).toHaveURL(outer);
    await expect(page.locator(".patch-crumbs")).toHaveCount(0);
    await expect(sub).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(inside);
    await expect(page.locator(".patch-crumbs")).toBeVisible();

    // A reload lands inside it again (once the autosave has run). Last:
    // Playwright's reload in Firefox adds a history entry of its own.
    await page.waitForTimeout(1000);
    await page.reload();
    await expect(page.locator(".patch-crumbs .patch-crumb")).toHaveText(
      ["Rainbow Sparkle ›", "Scope"],
      { timeout: 20_000 },
    );
  });

  test("a patch that isn't in this browser says so", async ({ page }) => {
    await page.goto("/playground/p/00000000-0000-0000-0000-000000000000");
    await expect(page.locator(".pg-notice")).toContainText(
      "isn't in this browser",
      { timeout: 20_000 },
    );
  });

  test("the files beside the playground are still themselves", async ({
    request,
  }) => {
    const res = await request.get("/playground/agents.md");
    expect(res.ok()).toBe(true);
    expect(await res.text()).not.toContain("<html");
  });
});
