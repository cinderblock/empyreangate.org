import { expect, test } from "@playwright/test";

test.describe("Home", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("has the title and description", async ({ page }) => {
    await expect(page).toHaveTitle("The Empyrean Gate");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      /ring of twenty-four thousand lights/,
    );
  });

  test("has Open Graph and Twitter cards", async ({ page }) => {
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      "The Empyrean Gate",
    );
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      "https://empyreangate.org/og.png",
    );
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      "content",
      "summary_large_image",
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://empyreangate.org/",
    );
  });

  test("has one h1 and the section headings", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "The Empyrean Gate",
    );
    const h2s = page.getByRole("heading", { level: 2 });
    await expect(h2s).toHaveCount(6);
  });

  test("section navigation points at real anchors", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "Sections" });
    const hrefs = await nav
      .locator("a[href^='#']")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href")!));
    expect(hrefs.length).toBeGreaterThanOrEqual(5);
    for (const href of hrefs) {
      await expect(page.locator(href)).toHaveCount(1);
    }
  });

  test("links to the software and to Entheos", async ({ page }) => {
    await expect(
      page
        .locator('a[href="https://github.com/TomSawyerLabs/empyrean-gate"]')
        .first(),
    ).toBeVisible();
    await expect(
      page.locator('a[href="https://www.entheosrising.org/"]').first(),
    ).toBeVisible();
  });

  test("names the next event with a machine-readable date", async ({
    page,
  }) => {
    const time = page.locator(".hero-next time");
    await expect(time).toHaveAttribute("dateTime", /^\d{4}-\d{2}-\d{2}$/);
  });

  test("ships structured data", async ({ page }) => {
    const json = await page
      .locator('script[type="application/ld+json"]')
      .textContent();
    const data = JSON.parse(json!);
    const types = data["@graph"].map((n: { "@type": string }) => n["@type"]);
    expect(types).toContain("VisualArtwork");
    expect(types).toContain("Event");
  });
});

test.describe("404", () => {
  test("is a real document with a way home", async ({ page }) => {
    await page.goto("/404");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Nothing here.",
    );
    const link = page.getByRole("link", { name: "Back to the gate" });
    await expect(link).toHaveAttribute("href", "/");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex",
    );
  });
});
