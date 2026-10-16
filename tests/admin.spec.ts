import { expect, test } from "@playwright/test";

/**
 * The crew's notifications page. The static preview has no Worker, so the
 * page must say notifications aren't set up rather than break; the manifest
 * and service worker it relies on are served.
 */
test.describe("Crew notifications", () => {
  test("renders, keeps the token, and says when push isn't set up", async ({
    page,
  }) => {
    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { name: "Notifications" }),
    ).toBeVisible();
    // noindex: not for search engines.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex",
    );
    await page.getByRole("textbox", { name: "Token" }).fill("secret-token");
    await page.getByRole("button", { name: "Keep on this device" }).click();
    expect(
      await page.evaluate(() => localStorage.getItem("empyrean-admin-token")),
    ).toBe("secret-token");
    // No /api on the static preview (or no push on a browser without it).
    await expect(page.locator("[data-admin]")).toHaveAttribute(
      "data-admin",
      /^(unconfigured|unsupported)$/,
      {
        timeout: 20_000,
      },
    );
  });

  test("the manifest, icons and service worker are served", async ({
    request,
  }) => {
    const manifest = await request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBe(true);
    const body = (await manifest.json()) as {
      start_url: string;
      icons: { src: string }[];
    };
    expect(body.start_url).toBe("/admin");
    for (const icon of body.icons) {
      const res = await request.get(icon.src);
      expect(res.ok(), icon.src).toBe(true);
      expect(res.headers()["content-type"]).toContain("image/png");
    }
    const sw = await request.get("/sw.js");
    expect(sw.ok()).toBe(true);
    expect(await sw.text()).toContain('addEventListener("push"');
  });

  test("robots keep out of /admin, and the sitemap leaves it out", async ({
    request,
  }) => {
    expect(await (await request.get("/robots.txt")).text()).toContain(
      "Disallow: /admin",
    );
    expect(await (await request.get("/sitemap.xml")).text()).not.toContain(
      "/admin",
    );
  });
});
