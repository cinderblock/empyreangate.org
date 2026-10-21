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

  test("the bar offers the real gate while it is live", async ({ page }) => {
    await page.route("**/api/live", (route) =>
      route.fulfill({
        json: { live: true, url: "https://play.example.org", open: true },
      }),
    );
    await page.goto("/playground");
    await expect(
      page.locator(".pg-bar").getByRole("link", { name: "Play it live ↗" }),
    ).toHaveAttribute("href", "https://play.example.org");
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

  test("on a desk, phone motion is a stand-in rather than a sensor that isn't there", async ({
    page,
  }) => {
    await expect(page.locator(".patch-name")).toHaveValue("Rainbow Sparkle", {
      timeout: 20_000,
    });
    // A desktop browser has DeviceOrientationEvent with nothing behind it.
    await expect(
      page.getByRole("button", { name: "Use phone motion" }),
    ).toHaveCount(0);
    const simulate = page.getByRole("button", {
      name: "Simulate phone motion",
    });
    await expect(simulate).toBeVisible();
    await expect(
      page.getByText("A stand-in for a phone in a dancer's hand."),
    ).toBeVisible();
    // With a preview running it toggles; without WebGPU it is simply disabled.
    if (await simulate.isEnabled()) {
      await simulate.click();
      const stop = page.getByRole("button", { name: "Stop simulated motion" });
      await expect(stop).toHaveAttribute("aria-pressed", "true");
      await stop.click();
      await expect(simulate).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator(".pg-notice")).toHaveCount(0);
    }
  });

  test("an event output gets a meter: Effect taps counts the taps on the gate", async ({
    page,
  }) => {
    await expect(page.locator(".patch-name")).toHaveValue("Rainbow Sparkle", {
      timeout: 20_000,
    });
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
      "no WebGPU in this browser: no meters",
    );
    await page.locator(".palette-item", { hasText: "Effect taps" }).click();
    const strip = page
      .locator(".pnode", { hasText: "Effect taps" })
      .locator(".mini-event");
    await expect(strip).toBeVisible();
    await expect(strip).toContainText("×0");
    // A tap on the gate (the finger tool) is exactly what this node reports.
    // The patch recompiles with the new node for a moment after it is added;
    // a tap in that window goes to the old simulation, so tap until counted.
    await expect
      .poll(
        async () => {
          await page
            .locator("canvas.pg-gate")
            .click({ position: { x: 150, y: 150 } });
          return strip.innerText();
        },
        { timeout: 10_000, intervals: [600] },
      )
      .toMatch(/×[1-9]/);
  });

  test("a stream source gets a thumbnail: Touch strokes shows what you draw", async ({
    page,
  }) => {
    await expect(page.locator(".patch-name")).toHaveValue("Rainbow Sparkle", {
      timeout: 20_000,
    });
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
      "no WebGPU in this browser: no thumbnails",
    );
    // Rainbow Sparkle already carries a Touch strokes node, which used to be
    // the one node on its canvas with nothing to show.
    const ring = page
      .locator(".pnode", { hasText: "Touch strokes" })
      .first()
      .getByRole("img", { name: "Touch strokes preview" });
    await expect(ring).toBeVisible();
    // The patch owns touch, so a stroke on the gate is what this node
    // carries, and its thumbnail lights where the stroke went. Stroke until
    // the first thumbnail refresh after it shows.
    const gate = page.locator("canvas.pg-gate");
    const litPixels = () =>
      ring.evaluate((c) => {
        const canvas = c as HTMLCanvasElement;
        const data = canvas
          .getContext("2d")!
          .getImageData(0, 0, canvas.width, canvas.height).data;
        let lit = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit++;
        return lit;
      });
    await expect
      .poll(
        async () => {
          const box = await gate.boundingBox();
          if (!box) return 0;
          await page.mouse.move(
            box.x + box.width * 0.3,
            box.y + box.height * 0.5,
          );
          await page.mouse.down();
          await page.mouse.move(
            box.x + box.width * 0.7,
            box.y + box.height * 0.5,
            {
              steps: 8,
            },
          );
          await page.mouse.up();
          return litPixels();
        },
        { timeout: 15_000, intervals: [800] },
      )
      .toBeGreaterThan(0);
  });

  // A browser can run the preview on WebGPU and still have no WebGL2 (a
  // blocklisted GPU, a privacy setting), and the thumbnails used to stay
  // blank there (reported 2026-10-20). They draw on a 2D canvas instead.
  test("the thumbnails draw without WebGL2", async ({ page }) => {
    await page.addInitScript(() => {
      type GetContext = (
        this: HTMLCanvasElement,
        id: string,
        options?: unknown,
      ) => RenderingContext | null;
      const real = HTMLCanvasElement.prototype.getContext as GetContext;
      HTMLCanvasElement.prototype.getContext = function (id, options) {
        return id === "webgl2" ? null : real.call(this, id, options);
      } as GetContext as typeof HTMLCanvasElement.prototype.getContext;
    });
    const notes: string[] = [];
    page.on("console", (m) => notes.push(m.text()));
    await page.goto("/playground");
    await expect(page.locator(".patch-name")).toHaveValue("Rainbow Sparkle", {
      timeout: 20_000,
    });
    const stage = page.locator(".pg-stage");
    await expect(stage).toHaveAttribute(
      "data-preview",
      /^(running|unavailable)$/,
      { timeout: 20_000 },
    );
    test.skip(
      (await stage.getAttribute("data-preview")) !== "running",
      "no WebGPU in this browser: no thumbnails",
    );
    const mostLit = () =>
      page.locator(".pnode .mini-ring").evaluateAll((rings) =>
        Math.max(
          0,
          ...rings.map((c) => {
            const canvas = c as HTMLCanvasElement;
            const data = canvas
              .getContext("2d")!
              .getImageData(0, 0, canvas.width, canvas.height).data;
            // Colour, not alpha: a dark LED paints opaque black.
            let lit = 0;
            for (let i = 0; i < data.length; i += 4) {
              if (Math.max(data[i], data[i + 1], data[i + 2]) > 32) lit++;
            }
            return lit;
          }),
        ),
      );
    await expect.poll(mostLit, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(notes.some((n) => n.includes("no WebGL2"))).toBe(true);
  });

  test("simulated visitors tap when nobody does: Effect taps counts them", async ({
    page,
  }) => {
    await expect(page.locator(".patch-name")).toHaveValue("Rainbow Sparkle", {
      timeout: 20_000,
    });
    const stage = page.locator(".pg-stage");
    await expect(stage).toHaveAttribute(
      "data-preview",
      /^(running|unavailable)$/,
      { timeout: 20_000 },
    );
    test.skip(
      (await stage.getAttribute("data-preview")) !== "running",
      "no WebGPU in this browser: no meters",
    );
    await page.locator(".palette-item", { hasText: "Effect taps" }).click();
    const node = page.locator(".pnode", { hasText: "Effect taps" });
    await node.click();
    // Its panel offers the visitors, the same switch as under People.
    const panel = page.locator(".patch-side .pg-visitors");
    await expect(panel).toBeVisible();
    await panel.getByLabel("Simulated visitors").check();
    await expect(
      page.locator(".pg-inputs").getByLabel("Simulated visitors"),
    ).toBeChecked();
    await expect(node.locator(".mini-event")).toContainText(/×[1-9]/, {
      timeout: 15_000,
    });
  });

  test("Video in plays a stand-in film until a camera or file is chosen", async ({
    page,
  }) => {
    await expect(page.locator(".patch-name")).toHaveValue("Rainbow Sparkle", {
      timeout: 20_000,
    });
    await page.locator(".palette-item", { hasText: "Video in" }).click();
    await page.locator(".pnode", { hasText: "Video in" }).click();
    const panel = page.locator(".patch-side .pg-video-in");
    await expect(panel).toContainText("stand-in film");
    await expect(
      panel.getByRole("button", { name: "Stand-in film" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByRole("button", { name: "Camera" })).toBeVisible();
    await expect(panel.getByText("Video file…")).toBeVisible();
  });

  test("the hue pull is a global, beside brightness and speed", async ({
    page,
  }) => {
    await expect(page.locator(".patch-name")).toHaveValue("Rainbow Sparkle", {
      timeout: 20_000,
    });
    const card = page.locator(".patch-globals");
    await expect(card.getByLabel("Hue pull")).toHaveValue("0");
    await card.getByLabel("Hue pull").fill("0.5");
    await card.getByLabel("Pull toward").fill("0.5");
    await expect(card).toContainText("50%");
    await expect(card).toContainText("180°");
  });

  test("the Phone IMU node can be driven by hand from its panel", async ({
    page,
  }) => {
    await expect(page.locator(".patch-name")).toHaveValue("Rainbow Sparkle", {
      timeout: 20_000,
    });
    await page.locator(".palette-item", { hasText: "Phone IMU" }).click();
    await page.locator(".pnode", { hasText: "Phone IMU" }).click();
    const panel = page.locator(".patch-side");
    await expect(panel.locator(".pg-imu")).toBeVisible();
    const byHand = panel.getByLabel("Drive it by hand");
    const yaw = panel.getByLabel(/Yaw/);
    await expect(yaw).toBeDisabled();
    // With a preview running the sliders take over the motion source.
    if (await byHand.isEnabled()) {
      await byHand.check();
      await expect(yaw).toBeEnabled();
      await yaw.fill("0.25");
      await expect(
        panel.locator(".patch-param-value").filter({ hasText: "0.25" }),
      ).toHaveCount(1);
      await panel.getByRole("button", { name: "Shake" }).click();
      // The Motion control reflects it, and stopping there releases the panel.
      const stop = page.getByRole("button", { name: "Stop simulated motion" });
      await expect(stop).toBeVisible();
      await stop.click();
      await expect(byHand).not.toBeChecked();
      await expect(yaw).toBeDisabled();
    }
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
    // A built-in opens as itself (read-only), and renders like any patch.
    await page.getByRole("button", { name: "📁 Patches" }).click();
    await page
      .locator(".patch-browser-panel .browser-item", {
        hasText: "Touch Ripples",
      })
      .first()
      .click();
    await expect(page.locator(".pg-owns-touch")).toBeVisible();
    await expect(page.getByLabel("Tool")).toHaveCount(0);
  });
});
