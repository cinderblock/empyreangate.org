import { expect, test } from "@playwright/test";

/**
 * The pattern playground. Headless browsers may or may not have WebGPU; the
 * editor must work either way (the preview is the only thing that needs it).
 */
test.describe("Pattern playground", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/playground");
  });

  test("opens the starter patch in the gate's editor", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Pattern playground" }),
    ).toBeVisible();
    // A first visit gets a copy of a built-in preset, already open.
    await expect(page.locator(".patch-name")).toHaveValue("Rainbow Sparkle", {
      timeout: 20_000,
    });
    // Its graph, explicit: the effects and strokes it shows are wired in too.
    await expect(
      page.locator(".pnode", { hasText: "Render effects" }),
    ).toHaveCount(1);
    await expect(
      page.locator(".pnode", { hasText: "Render points" }),
    ).toHaveCount(1);
    // The palette is the gate's registry, not a copy of it.
    await expect(page.locator(".palette-item").first()).toBeVisible();
    expect(await page.locator(".palette-item").count()).toBeGreaterThan(30);
  });

  test("links to the engine and the editor on GitHub", async ({ page }) => {
    const links = page.getByRole("navigation", { name: "Source code" });
    await expect(links.getByRole("link", { name: "Engine ↗" })).toHaveAttribute(
      "href",
      /github\.com\/TomSawyerLabs\/empyrean-gate\/.*crates\/empyrean-patch$/,
    );
    await expect(links.getByRole("link", { name: "Editor ↗" })).toHaveAttribute(
      "href",
      /github\.com\/TomSawyerLabs\/empyrean-gate\/.*packages\/patch-web$/,
    );
    await expect(links.getByRole("link", { name: "GitHub ↗" })).toHaveAttribute(
      "href",
      "https://github.com/TomSawyerLabs/empyrean-gate",
    );
  });

  test("previews live, or says why it can't", async ({ page }) => {
    const stage = page.locator(".pg-stage");
    await expect(stage).toHaveAttribute(
      "data-preview",
      /^(running|unavailable)$/,
      {
        timeout: 20_000,
      },
    );
    if ((await stage.getAttribute("data-preview")) === "running") {
      await expect(page.locator("canvas.pg-gate")).toBeVisible();
      await expect(page.locator(".patch-status.ok")).toHaveText(
        "patch rendering",
      );
    } else {
      await expect(page.locator(".pg-nogpu")).toContainText("WebGPU");
    }
  });

  test("the master brightness and speed sit in the canvas, not above it", async ({
    page,
  }) => {
    await expect(page.locator(".patch-name")).toHaveValue("Rainbow Sparkle", {
      timeout: 20_000,
    });
    // No separate Master fieldset: the card in the graph is the one place.
    await expect(
      page.locator(".pg-inputs legend", { hasText: "Master" }),
    ).toHaveCount(0);
    const card = page.locator(".patch-globals");
    await expect(card).toBeVisible();
    await expect(card).toHaveClass(/open/);
    await expect(card.getByLabel("Brightness")).toHaveValue("1");
    await card.getByLabel("Speed").fill("1.5");
    await expect(card.locator("output").nth(1)).toHaveText("1.50×");
    await expect(card).toContainText("here they're yours");
    // Collapsible to one line, values still on it.
    await card.getByRole("button", { name: /Hide the gate's globals/ }).click();
    await expect(card).toContainText("Brightness 100% · Speed 1.50×");
  });

  test("the masters are also a node a patch can wire", async ({ page }) => {
    await expect(page.locator(".patch-name")).toHaveValue("Rainbow Sparkle", {
      timeout: 20_000,
    });
    await page.locator(".palette-item", { hasText: "Gate globals" }).click();
    const node = page.locator(".pnode", { hasText: "Gate globals" });
    await expect(node).toHaveCount(1);
    for (const port of ["brightness", "speed", "hue", "hue_amount"]) {
      await expect(
        node.locator(".pnode-port.out", { hasText: new RegExp(`^${port}$`) }),
      ).toHaveCount(1);
    }
    // Unwired, it changes nothing: the patch still renders (or still says why not).
    await expect(page.locator(".patch-status.error")).toHaveCount(0);
  });

  test("Arrange lays the preset out without overlaps, source to Output", async ({
    page,
  }) => {
    await expect(page.locator(".patch-name")).toHaveValue("Rainbow Sparkle", {
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "⇆ Arrange" }).click();
    await page.waitForTimeout(500);
    const boxes = await page.locator(".react-flow__node").evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        const m = /translate\(([-\d.]+)px/.exec(
          (el as HTMLElement).style.transform,
        );
        return {
          label: el.querySelector(".pnode-head")?.textContent ?? "",
          x: Number(m?.[1]),
          l: r.left,
          t: r.top,
          r: r.right,
          b: r.bottom,
        };
      }),
    );
    expect(boxes.length).toBeGreaterThan(5);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const overlap = a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
        expect(overlap, `${a.label} / ${b.label}`).toBe(false);
      }
    }
    const output = boxes.find((n) => n.label.startsWith("Output"))!;
    const rainbow = boxes.find((n) => n.label.startsWith("Rainbow"))!;
    expect(output.x).toBeGreaterThan(rainbow.x);
    // One undo step.
    await page.getByRole("button", { name: "↶ Undo" }).click();
    await expect(page.getByRole("button", { name: "↷ Redo" })).toBeEnabled();
  });

  test("edits are kept in the browser across reloads", async ({ page }) => {
    await expect(page.locator(".patch-name")).toHaveValue("Rainbow Sparkle", {
      timeout: 20_000,
    });
    const before = await page.locator(".pnode").count();
    await page.locator(".palette-item", { hasText: "Plasma" }).click();
    await expect(page.locator(".pnode")).toHaveCount(before + 1);
    // Saves are debounced (600 ms), as on the gate.
    await page.waitForTimeout(1200);
    await page.reload();
    await expect(page.locator(".pnode")).toHaveCount(before + 1, {
      timeout: 20_000,
    });
  });

  test("a patch that cannot run says so", async ({ page }) => {
    await expect(page.locator(".patch-name")).toHaveValue("Rainbow Sparkle", {
      timeout: 20_000,
    });
    const before = await page.locator(".pnode").count();
    // Without an Output node there is nothing to render.
    await page.locator(".pnode", { hasText: "Output" }).click();
    await page.keyboard.press("Delete");
    await expect(page.locator(".pnode")).toHaveCount(before - 1);
    await expect(page.locator(".patch-status.error")).toContainText("Output");
  });

  test("a patch with Touch nodes owns the preview's touch", async ({
    page,
  }) => {
    const stage = page.locator(".pg-stage");
    await expect(stage).toHaveAttribute(
      "data-preview",
      /^(running|unavailable)$/,
      {
        timeout: 20_000,
      },
    );
    test.skip(
      (await stage.getAttribute("data-preview")) !== "running",
      "no WebGPU here, so no preview to touch",
    );
    await expect(page.locator(".patch-name")).toHaveValue("Rainbow Sparkle", {
      timeout: 20_000,
    });
    // The starter patch has no touch nodes: the tool picker is there.
    await expect(page.locator(".pg-inputs").getByLabel("Tool")).toBeVisible();
    await page
      .locator(".patch-toolbar select")
      .nth(1)
      .selectOption({ label: "Touch Ripples" });
    await expect(page.locator(".pg-owns-touch")).toBeVisible();
    await expect(page.getByLabel("Tool")).toHaveCount(0);
  });
});
