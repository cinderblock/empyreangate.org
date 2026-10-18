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

  test("links to the playground from the nav, hero and footer", async ({
    page,
  }) => {
    const nav = page.getByRole("navigation", { name: "Sections" });
    await expect(nav.getByRole("link", { name: "Playground" })).toHaveAttribute(
      "href",
      "/playground",
    );
    await expect(
      page.locator(".hero-actions").getByRole("link", {
        name: "Try the playground",
      }),
    ).toHaveAttribute("href", "/playground");
    await expect(
      page.locator(".site-footer").getByRole("link", {
        name: "Pattern playground",
      }),
    ).toHaveAttribute("href", "/playground");
  });

  test("offers Play it live, and what is on, only while the gate answers", async ({
    page,
  }) => {
    // The page is prerendered knowing nothing about the gate; the browser
    // asks /api/live once mounted (worker/index.ts), mocked here.
    await page.route("**/api/live", (route) =>
      route.fulfill({
        json: {
          live: true,
          url: "https://play.example.org",
          open: true,
          players: 2,
          nowPlaying: { name: "Ember Drift", credit: "Ada" },
        },
      }),
    );
    await page.goto("/");
    const button = page
      .locator(".hero-actions")
      .getByRole("link", { name: "Play it live ↗" });
    await expect(button).toHaveAttribute("href", "https://play.example.org");
    await expect(page.locator(".now-playing")).toContainText(
      "Ember Drift by Ada",
    );

    await page.route("**/api/live", (route) =>
      route.fulfill({ json: { live: false } }),
    );
    const answered = page.waitForResponse("**/api/live");
    await page.goto("/");
    await answered;
    await expect(button).toHaveCount(0);
    await expect(page.locator(".now-playing")).toHaveCount(0);
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

  test("the gallery shows only real photos in production", async ({ page }) => {
    const gallery = page.locator(".gallery");
    await expect(gallery.locator("img").first()).toBeAttached();
    await expect(gallery.locator(".gallery-item")).toHaveCount(
      await gallery.locator("img").count(),
    );
    await expect(gallery).not.toContainText("Photo coming");
  });

  test("credits the photographer under the caption", async ({ page }) => {
    const credits = page.locator(".gallery figcaption .photo-credit");
    await expect(credits.first()).toHaveText("Photo: TedX");
    await expect(credits.getByRole("link")).toHaveCount(0);
  });

  test("names the next event with a machine-readable date", async ({
    page,
  }) => {
    const time = page.locator(".hero-next time");
    await expect(time).toHaveAttribute("dateTime", /^\d{4}-\d{2}-\d{2}$/);
  });

  test("lists the timeline newest first, the next date at the top", async ({
    page,
  }) => {
    const dates = await page
      .locator(".timeline time")
      .evaluateAll((els) => els.map((e) => e.getAttribute("dateTime")!));
    expect(dates.length).toBeGreaterThan(1);
    expect(dates).toEqual([...dates].sort().reverse());
    await expect(page.locator(".timeline li").first()).toHaveClass("upcoming");
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

test.describe("People", () => {
  test("links contributors to their own sites", async ({ page }) => {
    await page.goto("/");
    const people = page.locator(".people");
    for (const [name, href] of [
      ['Cameron "Quadrangle" Tacklind', "https://cameron.tacklind.com/"],
      ["Theodore Wahrburg", "https://ted.wahrburg.dev/"],
      ["Allison Bellows", "https://github.com/allibell"],
      ["Anthony Fieldman", "https://www.anthonyfieldman.com/"],
      ["Eric Vicenti", "https://eric.vicenti.net/"],
      ["Kennedy Fabrications", "https://www.kennedyfabrications.com/"],
      ["Sight Unseen Studios", "https://www.sightunseenstudios.com/"],
      ["Uprising", "https://github.com/ericvicenti/uprising"],
    ]) {
      const link = people.getByRole("link", { name });
      await expect(link).toHaveAttribute("href", href);
      await expect(link).toHaveAttribute("target", "_blank");
      // The link is the icon; the name beside it is plain text.
      await expect(link).toHaveText("");
    }
  });

  test("lines names up whether or not they have a site icon", async ({
    page,
  }) => {
    await page.goto("/");
    const crew = page.locator(".crew li");
    await expect(crew.locator(".credited-link")).not.toHaveCount(0);
    // The x where each name's text starts, past any icon.
    const starts = await crew.evaluateAll((items) =>
      items.map((li) => {
        const text = [...li.querySelector(".credited")!.childNodes].find(
          (n) => n.nodeType === Node.TEXT_NODE,
        )!;
        const range = document.createRange();
        range.selectNodeContents(text);
        return Math.round(range.getBoundingClientRect().left);
      }),
    );
    expect(new Set(starts).size).toBe(1);
  });

  test("credits the 2023 artist panel", async ({ page }) => {
    await page.goto("/");
    const earlier = page.locator(".earlier");
    for (const text of [
      'James "Focus" Scott',
      "Nati Shabat",
      "Abraham Fuentes",
      "Adrien Lacquemant",
      'Walter "Rip Ions" Smith',
      "World of Kaleidoscopes",
      "HD Colors",
      "Meditative Mind",
      "Sleep Before Midnight",
      "Tony Grund",
    ]) {
      await expect(earlier).toContainText(text);
    }
    const donors = page.locator(".donors");
    for (const text of [
      "Matt Mullenweg",
      "Ed Chimney",
      "James Currier",
      "Whitmire Vo",
    ]) {
      await expect(donors).toContainText(text);
    }
  });

  test("lists people without a site as plain names", async ({ page }) => {
    await page.goto("/");
    const people = page.locator(".people");
    await expect(people.getByText("James Logistic")).toBeVisible();
    await expect(
      people.getByRole("link", { name: "James Logistic" }),
    ).toHaveCount(0);
  });

  test("lists earlier contributors most recent first", async ({ page }) => {
    await page.goto("/");
    const roles = await page.locator(".earlier .person-role").allTextContents();
    expect(roles[0]).toContain("unSCruz 2024");
    expect(roles[roles.length - 1]).toContain("Design, 2022");
  });

  test("credits James as crew and for the panel's concept and direction, not the design", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator(".crew")).toContainText("James Logistic");
    const james = page
      .locator(".earlier li")
      .filter({ hasText: 'James "Logistic" Tramel' });
    await expect(james).toHaveCount(1);
    await expect(james).toContainText("Concept and project direction");
    await expect(
      page.locator(".earlier li").filter({ hasText: "Design, 2022" }),
    ).not.toContainText("Tramel");
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
