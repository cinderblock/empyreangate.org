/**
 * The playground for AI agents: the gate's agent API (`@empyrean-gate/
 * patch-web/agent`) over this page's library, editor and preview, offered
 * two ways:
 *
 * - WebMCP (`document.modelContext`), for agents built into the browser;
 * - `window.empyrean`, a plain JS object, for agents that run scripts in the
 *   page (and for people at the console).
 *
 * Every change goes through the editor, so it shows where the person is
 * looking and is one step of their undo history. Submitting stays theirs:
 * an agent can open the Submit dialog filled in, never send it.
 */

import type {
  PatchDoc,
  PatchEditorHandle,
} from "@empyrean-gate/patch-web/editor";
import {
  createPatchApi,
  djTool,
  patchTools,
  registerWebMcp,
  type AgentTool,
  type DjHost,
  type PatchApi,
  type ToolResult,
} from "@empyrean-gate/patch-web/agent";
import {
  GATE_GEOMETRY,
  toBase64,
  type PatchCore,
  type PatchRuntime,
} from "@empyrean-gate/patch-web/runtime";
import { SITE } from "../content/site";
import type { LocalPatchStore } from "./store";

/** The playground's own controls an agent may set (the Sound and master
 * controls on the page; the DJ decks have their own tool, `dj_deck`). */
export interface PlaygroundInputs {
  /** The synthetic beat (off: silence, unless the microphone is on). */
  groove: boolean;
  /** Master brightness 0..1 and speed 0..3, as the crew sets them. */
  brightness: number;
  speed: number;
  /** The color a tap or stroke takes, 0..1. */
  hue: number;
  /** The microphone is feeding the audio (read-only: needs a person's click). */
  readonly mic: boolean;
}

export interface PlaygroundAgentDeps {
  core: PatchCore;
  runtime: PatchRuntime | null;
  /** The simulated DJ set the preview plays (null without a preview). */
  dj: DjHost | null;
  store: LocalPatchStore;
  editor: { current: PatchEditorHandle | null };
  inputs(): PlaygroundInputs;
  setInputs(next: Partial<Omit<PlaygroundInputs, "mic">>): void;
  /** Open the Submit dialog filled in; false where Submit isn't available. */
  openSubmit(initial: { name?: string; note?: string }): boolean;
}

/** What `window.empyrean` is: the API plus the tool list, by name. */
export type PlaygroundApi = PatchApi & {
  /** The same tools the browser's agent sees through WebMCP. */
  tools: Record<
    string,
    (input?: Record<string, unknown>) => Promise<ToolResult>
  >;
  /** `snapshot` as data: URLs, for a script that wants to show them. */
  snapshotUrls(
    options?: Parameters<PatchApi["snapshot"]>[0],
  ): Promise<string[]>;
};

declare global {
  interface Window {
    empyrean?: PlaygroundApi;
  }
}

const ACCESS =
  "You are in the Empyrean Gate's pattern playground (" +
  `${SITE.origin}/playground), a web page. Its tools are offered to the browser's agent through WebMCP, and the same ` +
  "API is `window.empyrean` in the page: `await empyrean.tools.get_guide()`, " +
  "`await empyrean.setPatch(doc)`, `await empyrean.edit([...ops])`, `await empyrean.snapshot({ frames: 4 })`, " +
  "`await empyrean.link()`; `Object.keys(empyrean.tools)` lists them. Changes show in the person's editor and live " +
  "preview, which plays a simulated 122 BPM DJ set (its sound as a synthetic groove, or their microphone) as the " +
  "music and the DJ's decks. set_inputs changes the playground's own controls; dj_deck reads and works the DJ " +
  "decks; trigger_effect taps the gate; open_submit opens the Submit dialog filled in for the person to send.";

function text(value: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text:
          typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

/** The playground's host for the agent API, its extra tools, and both ways
 * of offering them. Returns a cleanup. */
export function startPlaygroundAgent(deps: PlaygroundAgentDeps): () => void {
  const { core, runtime, store, editor } = deps;

  const api = createPatchApi({
    core,
    geometry: runtime?.geometry ?? GATE_GEOMETRY,
    getPatch: () => editor.current?.doc() ?? null,
    async setPatch(doc, asNew) {
      const ed = editor.current;
      if (!ed)
        throw new Error("The editor is still loading; try again in a moment.");
      let stored: PatchDoc;
      if (asNew || !ed.doc()) {
        stored = await store.put({ ...doc, id: "" });
        store.list();
        ed.open(stored);
        store.activate(stored.id);
      } else {
        ed.replace(doc);
        stored = { ...doc, id: ed.doc()?.id ?? doc.id };
      }
      if (!runtime) return { doc: stored, error: null };
      // The editor hands the same document to the runtime too; this call is
      // the one whose verdict we wait for.
      await runtime.setPatch(stored);
      return { doc: stored, error: runtime.getStatus().error };
    },
    capture: runtime ? (o) => runtime.capture(o) : undefined,
    linkBase: `${SITE.origin}/playground`,
    guide: { access: ACCESS, playground: `${SITE.origin}/playground` },
  });

  const effects = core.effectKinds.filter((k) => k !== "cone");
  const extra: AgentTool[] = [
    {
      name: "set_inputs",
      title: "Set the playground's controls",
      description:
        "The playground's own controls (not part of the patch): groove (the synthetic 122 BPM beat, the DJ set's " +
        "sound, standing in for the music), brightness (0..1) and speed (0..3) (the gate's master, set by the crew " +
        "on the night), hue (0..1, the color of taps and strokes). Returns them all. The DJ decks are dj_deck's.",
      inputSchema: {
        type: "object",
        properties: {
          groove: { type: "boolean" },
          brightness: { type: "number", minimum: 0, maximum: 1 },
          speed: { type: "number", minimum: 0, maximum: 3 },
          hue: { type: "number", minimum: 0, maximum: 1 },
        },
      },
      async execute(i) {
        const num = (v: unknown, lo: number, hi: number) =>
          typeof v === "number" && Number.isFinite(v)
            ? Math.min(hi, Math.max(lo, v))
            : undefined;
        const next: Partial<Omit<PlaygroundInputs, "mic">> = {};
        if (typeof i.groove === "boolean") next.groove = i.groove;
        const brightness = num(i.brightness, 0, 1);
        if (brightness !== undefined) next.brightness = brightness;
        const speed = num(i.speed, 0, 3);
        if (speed !== undefined) next.speed = speed;
        const hue = num(i.hue, 0, 1);
        if (hue !== undefined) next.hue = hue;
        deps.setInputs(next);
        return text({ ...deps.inputs(), ...next });
      },
    },
    {
      name: "trigger_effect",
      title: "Tap the gate",
      description:
        "Fire an effect, as a tap on the gate's screen would: kind (one of " +
        `${effects.join(", ")}), angle in turns 0..1 from spoke 0 (bottom) counter-clockwise, radius 0 (center) .. 1 ` +
        "(outer edge), hue 0..1. Shows only where the patch renders effects (an Effects in → Render effects chain).",
      inputSchema: {
        type: "object",
        properties: {
          kind: { enum: effects },
          angle: { type: "number" },
          radius: { type: "number", minimum: 0, maximum: 1 },
          hue: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["kind"],
      },
      async execute(i) {
        if (!runtime)
          throw new Error(
            "Nothing renders here (no WebGPU), so there is nothing to tap.",
          );
        const kind = String(i.kind);
        if (!effects.includes(kind))
          throw new Error(
            `no effect "${kind}" (effects: ${effects.join(", ")})`,
          );
        runtime.trigger({
          kind,
          angle: (typeof i.angle === "number" ? i.angle : 0) * Math.PI * 2,
          radius:
            typeof i.radius === "number"
              ? Math.min(1, Math.max(0, i.radius))
              : 0.6,
          hue: typeof i.hue === "number" ? i.hue : deps.inputs().hue,
          saturation: 0.85,
          brightness: 1,
        });
        return text(`Fired ${kind}. snapshot now (no restart) to see it.`);
      },
    },
    {
      name: "open_submit",
      title: "Open the Submit dialog",
      description:
        "Open the playground's Submit dialog for the open patch, with a name and a note filled in, so the person " +
        "can send it to the gate's crew. They review it, pass the spam check and press Send themselves; an agent " +
        "never submits. Only when they asked for it.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" }, note: { type: "string" } },
      },
      annotations: { consequentialHint: false },
      async execute(i) {
        const ok = deps.openSubmit({
          name: typeof i.name === "string" ? i.name : undefined,
          note: typeof i.note === "string" ? i.note : undefined,
        });
        if (!ok)
          throw new Error(
            "Submit isn't available here (it is not switched on yet, or no patch is open).",
          );
        return text("The Submit dialog is open for the person to complete.");
      },
    },
  ];

  if (deps.dj) extra.splice(1, 0, djTool(deps.dj));
  const tools = patchTools(api, extra);
  const byName: PlaygroundApi["tools"] = {};
  for (const t of tools) byName[t.name] = (input = {}) => t.execute(input);

  const pageApi: PlaygroundApi = Object.assign(
    Object.create(null) as object,
    api,
    {
      tools: byName,
      async snapshotUrls(options?: Parameters<PatchApi["snapshot"]>[0]) {
        const shot = await api.snapshot(options);
        return shot.images.map(
          (png) => `data:image/png;base64,${toBase64(png)}`,
        );
      },
    },
  );
  window.empyrean = pageApi;

  const abort = new AbortController();
  void registerWebMcp(tools, abort.signal).then((n) => {
    if (n > 0) document.documentElement.dataset.webmcp = String(n);
  });

  return () => {
    abort.abort();
    delete document.documentElement.dataset.webmcp;
    if (window.empyrean === pageApi) delete window.empyrean;
  };
}
