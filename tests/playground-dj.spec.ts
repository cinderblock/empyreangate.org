import { expect, test, type Page } from "@playwright/test";

/**
 * The playground's DJ decks: the simulated PRO DJ LINK set (the gate's
 * package plays it) behind `dj_link` nodes. It plays with the live preview,
 * so most of this needs WebGPU (`bun run test:gpu`).
 */

async function preview(page: Page): Promise<boolean> {
  await page.goto("/playground");
  const stage = page.locator(".pg-stage");
  await expect(stage).toHaveAttribute(
    "data-preview",
    /^(running|unavailable)$/,
    { timeout: 20_000 },
  );
  return (await stage.getAttribute("data-preview")) === "running";
}

test.describe("DJ decks", () => {
  test("without a preview the panel says the decks need it", async ({
    page,
  }) => {
    test.skip(await preview(page), "this browser has WebGPU");
    await expect(page.locator(".pg-dj")).toContainText(
      "The decks play with the live preview.",
    );
  });

  test("the Auto DJ plays a set, and the patch sees it", async ({ page }) => {
    test.skip(!(await preview(page)), "no WebGPU in this browser");
    const decks = page.locator(".pg-dj-deck");
    await expect(decks).toHaveCount(2);
    await expect(decks.nth(0)).toContainText("Ember Theory");
    await expect(decks.nth(0)).toHaveAttribute("data-on-air", "true");
    await expect(decks.nth(1)).toHaveAttribute("data-on-air", "false");
    await expect(page.getByLabel("Auto DJ")).toBeChecked();
    const sees = page.locator(".pg-dj-sees");
    await expect(sees).toContainText("active");
    await expect(sees).toContainText("deck 1");
    await expect(sees).toContainText("playing, on air");
    // A phrase change 32 beats in (about 16 s): skip there with the tool.
    await page.evaluate(() =>
      window.empyrean!.tools.dj_deck!({ start_at: 14 }),
    );
    await expect(
      page.locator(".pg-dj-event[data-lit=true]", { hasText: "Phrase" }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(sees).toContainText("Build");
  });

  test("unplugging the LINK is what a gate without CDJs sees", async ({
    page,
  }) => {
    test.skip(!(await preview(page)), "no WebGPU in this browser");
    await page.getByLabel("LINK connected").uncheck();
    const sees = page.locator(".pg-dj-sees");
    await expect(sees).toContainText("inactive");
    await expect(sees).toContainText("deck –");
    await expect(page.locator(".pg-dj")).toContainText("Unplugged");
    await page.getByLabel("LINK connected").check();
    await expect(sees).not.toContainText("inactive");
  });

  test("holding Cue on the waiting deck is cue-play: Play and Cue fire, Auto steps aside", async ({
    page,
  }) => {
    test.skip(!(await preview(page)), "no WebGPU in this browser");
    const deck2 = page.locator(".pg-dj-deck").nth(1);
    const cue = deck2.getByRole("button", { name: "Cue (hold)" });
    await cue.hover();
    await page.mouse.down();
    await expect(deck2).toContainText("Cue-play (held)");
    await expect(
      page.locator(".pg-dj-event[data-lit=true]", { hasText: /^Play/ }),
    ).toBeVisible();
    await expect(
      page.locator(".pg-dj-event[data-lit=true]", { hasText: /^Cue\d?$/ }),
    ).toBeVisible();
    await page.mouse.up();
    await expect(deck2).toContainText("At the cue");
    await expect(page.getByLabel("Auto DJ")).not.toBeChecked();
  });

  test("an agent works the decks through dj_deck", async ({ page }) => {
    test.skip(!(await preview(page)), "no WebGPU in this browser");
    const report = await page.evaluate(async () => {
      const r = await window.empyrean!.tools.dj_deck!({
        deck: 2,
        action: "load",
        track: 3,
      });
      return JSON.parse(
        r.content[0]!.type === "text" ? r.content[0]!.text : "{}",
      ) as { auto: boolean; decks: { track: string | null }[] };
    });
    expect(report.auto).toBe(false);
    expect(report.decks[1]!.track).toContain("Night Market");
    await expect(page.locator(".pg-dj-deck").nth(1)).toContainText(
      "Night Market",
    );
    await expect(page.getByLabel("Auto DJ")).not.toBeChecked();
  });
});
