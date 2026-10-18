import { expect, test, type Page } from "@playwright/test";

/**
 * The playground for AI agents: `window.empyrean`, the WebMCP tools, patches
 * in links, and the generated docs. The editor half works without WebGPU;
 * looking at the patch (`snapshot`) needs it and skips itself where it is
 * missing (`bun run test:gpu` runs it in Chrome with a GPU).
 */

const SIMPLE = {
  format: 5,
  id: "",
  name: "Agent rainbow",
  description: "Made by a test standing in for an agent.",
  nodes: [
    { id: "bow", kind: "rainbow", name: "", params: { speed: 0.2 } },
    { id: "out", kind: "output", name: "", params: {} },
  ],
  edges: [
    {
      from: { node: "bow", port: "out" },
      to: { node: "out", port: "in" },
    },
  ],
  exposed: [],
};

async function ready(page: Page) {
  await expect(page.locator(".patch-name")).toHaveValue("Rainbow Sparkle", {
    timeout: 20_000,
  });
  await page.waitForFunction(() => window.empyrean !== undefined);
}

test.describe("Playground for agents", () => {
  test("window.empyrean offers the tools and the guide", async ({ page }) => {
    await page.goto("/playground");
    await ready(page);
    const tools = await page.evaluate(() =>
      Object.keys(window.empyrean!.tools),
    );
    for (const name of [
      "get_guide",
      "list_node_types",
      "describe_node_types",
      "list_presets",
      "get_preset",
      "open_preset",
      "get_patch",
      "validate_patch",
      "set_patch",
      "edit_patch",
      "share_link",
      "set_inputs",
      "trigger_effect",
      "open_submit",
    ]) {
      expect(tools).toContain(name);
    }
    const guide = await page.evaluate(async () => {
      const r = await window.empyrean!.tools.get_guide!({ brief: true });
      return r.content[0]!.type === "text" ? r.content[0]!.text : "";
    });
    expect(guide).toContain("# Making patterns for the Empyrean Gate");
    expect(guide).toContain("window.empyrean");
  });

  test("an agent's patch lands in the editor, one undo away", async ({
    page,
  }) => {
    await page.goto("/playground");
    await ready(page);
    const result = await page.evaluate(
      (doc) => window.empyrean!.setPatch(doc as never),
      SIMPLE,
    );
    expect(result.errors).toEqual([]);
    expect(result.id).toBeTruthy();
    await expect(page.locator(".patch-name")).toHaveValue("Agent rainbow");
    await expect(page.locator(".pnode")).toHaveCount(2);

    // Small edits, without resending the patch.
    const edited = await page.evaluate(() =>
      window.empyrean!.edit([
        { op: "add_node", kind: "sparkle", id: "spark" },
        { op: "add_node", kind: "blend", id: "mix" },
        { op: "connect", from: "bow.out", to: "mix.base" },
        { op: "connect", from: "spark.out", to: "mix.over" },
        { op: "connect", from: "mix.out", to: "out.in" },
        { op: "set_info", name: "Agent rainbow, sparkling" },
      ]),
    );
    expect(edited.errors).toEqual([]);
    await expect(page.locator(".patch-name")).toHaveValue(
      "Agent rainbow, sparkling",
    );
    await expect(page.locator(".pnode")).toHaveCount(4);

    // The person can take it back.
    await page.locator(".react-flow__pane").click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.locator(".patch-name")).toHaveValue("Agent rainbow");
    await expect(page.locator(".pnode")).toHaveCount(2);
  });

  test("a patch that does not validate is not applied", async ({ page }) => {
    await page.goto("/playground");
    await ready(page);
    const result = await page.evaluate(() =>
      window.empyrean!.setPatch({
        format: 5,
        id: "",
        name: "Broken",
        description: "",
        nodes: [
          { id: "x", kind: "no_such_node", name: "", params: {}, pos: [0, 0] },
        ],
        edges: [],
        exposed: [],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("no_such_node");
    await expect(page.locator(".patch-name")).toHaveValue("Rainbow Sparkle");
  });

  test("a link opens its patch as a new one in the library", async ({
    page,
  }) => {
    await page.goto(
      `/playground#patch=${encodeURIComponent(JSON.stringify(SIMPLE))}`,
    );
    await expect(page.locator(".patch-name")).toHaveValue("Agent rainbow", {
      timeout: 20_000,
    });
    await expect(page.locator(".pg-notice")).toContainText(
      'Opened "Agent rainbow" from a link',
    );
    // The fragment is spent: a reload reopens it from the library, once.
    expect(new URL(page.url()).hash).toBe("");

    // A link the page makes opens the same thing elsewhere.
    await page.waitForFunction(() => window.empyrean !== undefined);
    const link = await page.evaluate(() => window.empyrean!.link());
    expect(link).toMatch(/\/playground#patch=z[\w-]+$/);
    const other = await page.context().newPage();
    await other.goto(link.replace(/^https?:\/\/[^/]+/, ""));
    await expect(other.locator(".patch-name")).toHaveValue("Agent rainbow", {
      timeout: 20_000,
    });
  });

  test("tools are offered through WebMCP where the browser has it", async ({
    page,
  }) => {
    // A stand-in for the browser's WebMCP, recording what registers.
    await page.addInitScript(() => {
      const tools = new Map<string, { execute: (i: object) => unknown }>();
      Object.defineProperty(document, "modelContext", {
        value: {
          registerTool(
            tool: { name: string; execute: (i: object) => unknown },
            options?: { signal?: AbortSignal },
          ) {
            tools.set(tool.name, tool);
            options?.signal?.addEventListener("abort", () =>
              tools.delete(tool.name),
            );
            return Promise.resolve();
          },
        },
      });
      (window as unknown as { __webmcp: typeof tools }).__webmcp = tools;
    });
    await page.goto("/playground");
    await ready(page);
    await expect(page.locator("html")).toHaveAttribute("data-webmcp", /\d+/);
    const names = await page.evaluate(() => [
      ...(
        window as unknown as { __webmcp: Map<string, unknown> }
      ).__webmcp.keys(),
    ]);
    expect(names).toContain("set_patch");
    expect(names).toContain("get_guide");
    const patch = await page.evaluate(async () => {
      const t = (
        window as unknown as {
          __webmcp: Map<string, { execute: (i: object) => Promise<unknown> }>;
        }
      ).__webmcp.get("get_patch")!;
      return t.execute({});
    });
    expect(JSON.stringify(patch)).toContain("Rainbow Sparkle");
  });

  test("open_submit fills the dialog in but leaves sending to the person", async ({
    page,
  }) => {
    await page.goto("/playground");
    await ready(page);
    const result = await page.evaluate(() =>
      window.empyrean!.tools.open_submit!({
        name: "Ada",
        note: "From my agent",
      }),
    );
    if (result.isError) {
      // Submit is not switched on in this build (no Turnstile site key).
      expect(JSON.stringify(result)).toContain("isn't available");
      return;
    }
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/name/i).first()).toHaveValue("Ada");
  });

  test("the bar says where agents should start", async ({ page }) => {
    await page.goto("/playground");
    await expect(
      page.getByRole("link", { name: "Using an AI agent?" }),
    ).toHaveAttribute("href", "/playground/agents.md");
    await expect(
      page.locator('link[rel="alternate"][type="text/markdown"]'),
    ).toHaveAttribute("href", "/playground/agents.md");

    // Chrome's WebMCP origin trial, in the prerendered head.
    const token = await page
      .locator('meta[http-equiv="origin-trial"]')
      .getAttribute("content");
    const payload = JSON.parse(
      Buffer.from(token!, "base64").subarray(69).toString("utf8"),
    ) as { origin: string; feature: string; isSubdomain: boolean };
    expect(payload).toMatchObject({
      origin: "https://empyreangate.org:443",
      feature: "WebMCP",
      isSubdomain: true,
    });
  });

  test("snapshot shows the running patch", async ({ page }) => {
    await page.goto("/playground");
    await ready(page);
    const stage = page.locator(".pg-stage");
    await expect(stage).toHaveAttribute(
      "data-preview",
      /^(running|unavailable)$/,
      { timeout: 20_000 },
    );
    test.skip(
      (await stage.getAttribute("data-preview")) !== "running",
      "needs WebGPU",
    );
    const shot = await page.evaluate(async () => {
      const r = await window.empyrean!.snapshot({ frames: 3, restart: true });
      return {
        frames: r.frames,
        sizes: r.images.map((p) => p.length),
        head: [...r.images[0]!.slice(0, 4)],
      };
    });
    expect(shot.frames).toHaveLength(3);
    expect(shot.sizes).toHaveLength(1);
    expect(shot.head).toEqual([137, 80, 78, 71]);
    // Rainbow Sparkle lights the whole ring.
    expect(shot.frames[0]!.stats.lit).toBeGreaterThan(0.5);
  });
});

test.describe("Docs for agents", () => {
  test("llms.txt points at the guide", async ({ request }) => {
    const res = await request.get("/llms.txt");
    expect(res.ok()).toBe(true);
    const text = await res.text();
    expect(text).toMatch(/^# The Empyrean Gate/);
    expect(text).toContain("/playground/agents.md");
  });

  test("the guide covers the format, the tools and every node", async ({
    request,
  }) => {
    const guide = await (await request.get("/playground/agents.md")).text();
    const registry = (await (
      await request.get("/playground/registry.json")
    ).json()) as { id: string }[];
    expect(registry.length).toBeGreaterThan(30);
    expect(guide).toContain("## Workflow");
    expect(guide).toContain("## Wire shapes");
    expect(guide).toContain("## The Code node");
    expect(guide).toContain("empyrean-patch mcp");
    for (const t of registry) expect(guide).toContain(`### \`${t.id}\``);
  });

  test("the schema and presets are there as JSON", async ({ request }) => {
    const schema = await (
      await request.get("/playground/patch.schema.json")
    ).json();
    expect(JSON.stringify(schema)).toContain("nodes");
    const presets = (await (
      await request.get("/playground/presets.json")
    ).json()) as { name: string }[];
    expect(presets.map((p) => p.name)).toContain("Rainbow Sparkle");
  });
});
