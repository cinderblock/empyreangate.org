/**
 * Docs for AI agents, generated from the gate's patch core at build time, so
 * they describe exactly the engine this build's playground runs:
 *
 *   /llms.txt                      the site in brief, pointing at the rest
 *   /playground/agents.md          the guide: format, shapes, workflow, the
 *                                  Code node, every node type
 *   /playground/registry.json      the node palette
 *   /playground/patch.schema.json  JSON Schema of a patch document
 *   /playground/presets.json       the built-in patches
 *
 * Called by postbuild.ts with the output directory and this build's origin.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { agentGuide } from "@empyrean-gate/patch-web/agent";
import { loadPatchCore } from "@empyrean-gate/patch-web/runtime";

const GATE_PACKAGE = "github:TomSawyerLabs/empyrean-gate#web-dist";

function access(origin: string): string {
  return [
    "Three ways in, all with the same tools (`get_guide`, `list_node_types`, `describe_node_types`, `list_presets`, " +
      "`get_preset`, `open_preset`, `get_patch`, `validate_patch`, `set_patch`, `edit_patch`, `snapshot`, " +
      "`share_link`):",
    "",
    `- **In the browser**, on [the playground](${origin}/playground): the page offers its tools to the browser's ` +
      "agent through [WebMCP](https://webmachinelearning.github.io/webmcp/) (`document.modelContext`), and as " +
      "`window.empyrean` to anything that can run a script in the page: `await empyrean.tools.get_guide()`, " +
      "`await empyrean.setPatch(doc)`, `await empyrean.edit(ops)`, `await empyrean.snapshot({ frames: 4 })` " +
      "(`snapshotUrls` for data: URLs). There are four more there: `set_inputs` (the synthetic beat, master " +
      "brightness and speed, tap color), `dj_deck` (the simulated PRO DJ LINK set that drives `dj_link` nodes: read " +
      "the decks, unplug the LINK, take them over, start the set at a time), `trigger_effect` (tap the gate) and " +
      "`open_submit` (open the Submit dialog filled in, for the person to send). Changes appear in the person's " +
      "editor and live preview.",
    "- **With no browser**: write the patch JSON and give the person a link that opens it " +
      `(\`${origin}/playground#patch=\` + the JSON, percent-encoded; see Links below).`,
    "- **On the command line** (Node 22+): `npx -p webgpu -p " +
      `${GATE_PACKAGE} empyrean-patch <command>\` — \`guide\`, \`nodes\`, \`presets\`, \`validate\`, \`link\`, ` +
      "`render` (PNG frames, through WebGPU from the `webgpu` package; `--at <s>` starts the simulated DJ set " +
      "there, `--no-link` unplugs it) and `mcp`, an MCP server on stdio with the same tools (and `dj_deck`), which " +
      "coding agents can add (e.g. `claude mcp add empyrean -- npx -y -p webgpu -p " +
      `${GATE_PACKAGE} empyrean-patch mcp pattern.json\`).`,
  ].join("\n");
}

function llmsTxt(
  origin: string,
  presets: { name: string; description: string }[],
): string {
  return [
    "# The Empyrean Gate",
    "",
    "> A ring of light over a dance floor: 64 spokes of LEDs, a gateway, and a fire beneath it, made by the " +
      "Entheos community. This site has its story, its appearances, and a pattern playground where anyone can " +
      "build a light pattern for it in the browser, with the gate's own node editor and render engine.",
    "",
    "AI agents are welcome to build patterns with people. Read the guide first; it covers the patch format, the " +
      "tools (WebMCP in the playground page, `window.empyrean`, links, and a command-line MCP server) and every node.",
    "",
    "## Pattern playground",
    "",
    `- [Agent guide](${origin}/playground/agents.md): how to make patterns, the patch format, the tools, every node type`,
    `- [Playground](${origin}/playground): the editor and live preview; its tools are offered through WebMCP`,
    `- [Node registry](${origin}/playground/registry.json): every node type as JSON`,
    `- [Patch JSON Schema](${origin}/playground/patch.schema.json): the document format`,
    `- [Presets](${origin}/playground/presets.json): the built-in patches as JSON (${presets.map((p) => p.name).join(", ")})`,
    "",
    "## Optional",
    "",
    `- [Home](${origin}/): the gate, its story, its people`,
    "- [Source](https://github.com/TomSawyerLabs/empyrean-gate): the gate's software, including the patch engine",
    "",
  ].join("\n");
}

export async function writeAgentDocs(
  out: string,
  origin: string,
): Promise<string[]> {
  // The wasm file of the installed package (fetch cannot read files here).
  const require = createRequire(import.meta.url);
  const pkg = dirname(require.resolve("@empyrean-gate/patch-web/package.json"));
  const core = await loadPatchCore(
    await readFile(join(pkg, "wasm", "patch_bg.wasm")),
  );

  const playground = join(out, "playground");
  await mkdir(playground, { recursive: true });
  const files: [string, string][] = [
    [
      join(playground, "agents.md"),
      agentGuide(core, {
        access: access(origin),
        playground: `${origin}/playground`,
      }),
    ],
    [
      join(playground, "registry.json"),
      JSON.stringify(core.registry, null, 2) + "\n",
    ],
    [
      join(playground, "patch.schema.json"),
      JSON.stringify(core.schema, null, 2) + "\n",
    ],
    [
      join(playground, "presets.json"),
      JSON.stringify(core.presets, null, 2) + "\n",
    ],
    [join(out, "llms.txt"), llmsTxt(origin, core.presets)],
  ];
  for (const [path, text] of files) await writeFile(path, text, "utf8");
  return files.map(([path]) => path);
}
