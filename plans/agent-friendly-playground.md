# Agent-friendly playground

Status: **in progress** (started 2026-10-17). Current step marked below.

## Goal

Let people point their AI agents at the pattern playground and have the
agent build, see and refine a gate pattern for them, without driving the
React Flow GUI by screen. Three kinds of agent, three ways in:

| Agent                                                 | Way in                                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Browser agents (Claude in Chrome, Gemini in Chrome …) | WebMCP tools on `/playground` (`document.modelContext`), plus a plain `window.empyrean` API |
| Chat agents with no browser                           | Docs at `/llms.txt` → `/playground/agents.md`; they hand the person a `#patch=` link        |
| Coding agents (Claude Code, Codex …)                  | A CLI / stdio MCP server from the gate's `web-dist` package: validate, render to PNG, link  |

Every way in exposes the **same tool set**, defined once in the gate's
`patch-web` package, so a tool means the same thing everywhere.

## Environment / context

| What                      | Where / value                                                                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Site repo                 | `C:\Users\camer\git\Personal Projects\empyreangate.org`, branch `dev` (shared working tree; push `dev` only, never `master`)                                                                                    |
| Gate repo                 | `github.com/TomSawyerLabs/empyrean-gate`; commits go straight to `master` (allowed), CI then appends to `web-dist`                                                                                              |
| Gate worktree (this task) | `C:\Users\camer\.t3\worktrees\Empyrean\agent-api`, branch `agent-api` from `origin/master` `eeb68ee`                                                                                                            |
| Gate main checkout        | `C:\Users\camer\git\Personal Projects\Empyrean` is 51 behind and someone's: don't use it. `.t3/worktrees/Empyrean/playground` has another thread's uncommitted `bun.lock` / `package.json`: don't use it either |
| Package                   | `packages/patch-web` (TS source, exported as `.ts`); wasm from `crates/empyrean-patch-wasm`; `scripts/assemble-dist.ts` builds web-dist                                                                         |
| Site pin                  | `bun.lock` → web-dist commit; the "Web dist bump" workflow moves it every 15 min. **Don't bump by hand** (see `.agents.txt`)                                                                                    |
| Editor                    | `packages/patch-web/src/editor/PatchEditor.tsx`; `openAs(doc, asNew)` / `mutateDoc` / `History`; store events drive it                                                                                          |
| Runtime                   | `packages/patch-web/src/runtime/{index,gpu,core}.ts`; `GateGpu.out` is `COPY_SRC` (2 frames of packed RGB u32; first is current)                                                                                |
| Site playground           | `app/playground/Playground.tsx` (host: IndexedDB store, groove, DJ stand-in, tools), `store.ts`                                                                                                                 |
| Registry                  | `crates/empyrean-patch/src/registry.rs`: 67 node types; ports/params have names + labels but **no descriptions** (before this)                                                                                  |

### WebMCP (checked 2026-10-17)

- Spec: Draft Community Group Report (Web Machine Learning CG), 16 Oct 2026,
  https://webmachinelearning.github.io/webmcp/. Not a standard.
- API: `document.modelContext.registerTool(tool, { signal })`; tool =
  `{ name, title?, description, inputSchema?, execute(input, { signal }),
annotations?: { readOnlyHint, untrustedContentHint, consequentialHint } }`.
  The result is JSON-serialized. Unregister by aborting the signal.
  `navigator.modelContext` is the older, deprecated location (Chrome 150
  still ships both).
- Chrome: origin trial M149–M156 (Blink intent LGTM 2026-05-18). Without a
  trial token for empyreangate.org it works only with the flag on.

## Decisions already made (don't re-ask)

- **Do all four tiers** (Cameron, 2026-10-17: "do it all!"): page API +
  WebMCP, `#patch=` links, generated agent docs, headless CLI.
- **Registry descriptions live in the gate's `registry.rs`** (implied by the
  above; the editor's palette shows them too).
- **Submit stays human.** Tools may open the Submit dialog pre-filled; the
  Turnstile check and the Send click stay with the person.
- **One tool definition** in `patch-web` (`agent/`), adapted per host.

## Design

Gate, `packages/patch-web` (+ crate):

1. **Descriptions** on node types, ports and params in `registry.rs`,
   serialized into the registry JSON; `types.ts` fields; editor tooltips.
2. **JSON Schema** of `PatchDoc`, from the Rust types (`schemars`), exported
   by the wasm (`schema()`), so it cannot drift from the loader.
3. **Runtime control**: `pause()` / `resume()`, public `step(dt)` that runs
   exactly one frame (deterministic stepping), `restart()` (fresh sim from
   the current doc), `readFrame()` → LED RGB (`spokes × pixels × 3`).
4. **`ring.ts`** (pure TS, no GPU): `renderRing(rgb, geometry, size)` →
   RGBA (additive glow dots like the view shader), `contactSheet`,
   `frameStats` (lit fraction, mean brightness, dominant hues),
   `encodePng` (CompressionStream deflate; works in browsers, Bun, Node).
5. **Headless-capable GPU**: `GateGpu` takes an injected `GPU`, creates the
   view pipeline lazily (no canvas format needed for compute-only use);
   `loadPatchCore` accepts wasm bytes (Node/Bun can't fetch `file:`).
6. **`agent/`**: `patchTools(host)` → tool list (name, title, description,
   JSON-Schema input, annotations, execute) returning MCP-style
   `{ content: [...] }`; `agentGuide(core)` → markdown guide generated from
   the registry; `patchLink(doc, base)` / `readPatchLink(hash)`
   (deflate-raw + base64url in the fragment).
7. **Editor handle** (`editorRef`): `doc()`, `open(doc, asNew)`,
   `apply(doc)` (one undoable edit, so a person can Ctrl+Z an agent),
   `arrange()`.
8. **CLI** `empyrean-patch` (bundled JS in web-dist, `bin`): `guide`,
   `nodes [kind]`, `validate`, `link`, `render` (WebGPU through the optional
   `webgpu` npm package, Dawn), `mcp` (stdio MCP server, same tools).

Site:

9. **Playground host**: `window.empyrean` + WebMCP registration (both
   locations, feature-detected, unregistered on unmount); site-only tools
   (inputs: groove, hue, brightness/speed, taps; open Submit pre-filled).
10. **`#patch=` import**: a link adds a new library entry and opens it; never
    overwrites.
11. **Generated docs at build**: `/llms.txt`, `/playground/agents.md`,
    `/playground/registry.json`, `/playground/patch.schema.json`; a visible
    "Using an AI agent?" link on the page; `<link rel="alternate">`.
12. Tests (Playwright: API, WebMCP with a stub, link import, docs), README.

## Plan / steps

1. [x] Gate: descriptions + shapes + schema (helper, branch `agent-registry-docs`, 4 commits)
2. [x] Gate: runtime control, `ring.ts`, headless GPU, core bytes, groove
3. [x] Gate: `agent/` tools, guide, link codec; editor handle; inline descriptions
4. [x] Gate: CLI + MCP server; assemble-dist bundles it; READMEs
5. [x] Gate: tests (bun unit 41 pass; editor specs `patch-*` 27/27 chromium)
6. [x] Site (worktree `C:\Users\camer\.t3\worktrees\empyreangate.org\agent-friendly`, branch `agent-friendly` from `origin/dev`): host + WebMCP + window API, `#patch=` import, docs generation, README
7. [ ] **current** Site: full Playwright (3 browsers) + GPU suite against the locally assembled package
8. [ ] Ship: push gate `agent-api` → `master` (fast-forward) → CI appends web-dist → bump bot (or `gh workflow run web-dist-bump.yml --ref dev`) → rebase site branch on `origin/dev` → push `dev`
9. [ ] Verify on the `dev` Preview: docs URLs, `window.empyrean`, a link, snapshot (Claude in Chrome)

## Findings / gotchas

- `requestAnimationFrame` drives the runtime; `step()` must not race it, so
  capture pauses the loop, steps, reads, then resumes.
- Node refuses to strip TS types under `node_modules`, so the CLI must ship
  as bundled JS, not as the package's `.ts` sources.
- **Dawn (`webgpu` npm 0.6.2, 137 MB unpacked, prebuilt win32/linux/darwin)
  works under Node 24 but crashes Bun 1.4.2** (`bun.report` segfault in
  dawn.node on the first adapter request). The CLI therefore targets Node.
- **dawn.node segfaults if the `GPU` object from `create()` is garbage
  collected** while its devices are in use: the CLI rendered fine from a
  harness holding it in a module-level const, and crashed (exit 139) in
  `setPatch` when only the device was kept. `cli/host.ts` holds it for the
  process's life.
- `parsePatchFile` dropped Code nodes' `code` (fixed, gate `931c265`).
- `set_patch` replaces the open patch only when the document carries its id
  (an agent that read it with `get_patch`); a fresh document opens as a new
  library entry. The first draft replaced whatever was open: too easy to
  lose the person's work.
- Another thread landed the CodeMirror Code editor + `codeReference()` on
  gate master mid-task (c83b8c0, 119a451); rebased onto it, no conflicts
  beyond `bun.lock` (regenerated with `bun install`).
- The tooltips rule (no `title=`) means registry descriptions show inline in
  the node panel, not as hover text on palette buttons.

## Progress log

- [x] Survey (2026-10-17): editor/runtime/store contracts, web-dist layout, WebMCP status
- [x] Gate `931c265`: parsePatchFile keeps Code nodes (side fix)
- [x] Gate (uncommitted, agent-api): `runtime/ring.ts` (+ tests, 8 pass),
      `GateGpu` headless + `readFrame`, `PatchRuntime` step/restart/capture,
      `runtime/groove.ts`, `editor/minis-source.ts` split, `agent/`
      (api, edit, guide, link, tools), editor handle + inline descriptions,
      CLI (`cli/{main,host,mcp}.ts`, `scripts/build-cli.ts`); CLI `render`
      verified under Node with Dawn (4-frame sheet of Rainbow Sparkle)
- [x] Helper done (2026-10-17): descriptions for all 67 nodes/ports/params,
      `shapes()`, `schema()` (schemars, draft 2020-12); 111 crate tests. Its
      `code_reference()` was dropped: master already had `codeReference()`
      (`reference.rs`, another thread). Gaps in it logged in gate ISSUES.md.
- [x] Gate commits on `agent-api` (rebased on master f498703 + helper):
      `9c5fed6` Code nodes in files, `47041e5` runtime, `8dcd4b2` editor,
      `b73295b` agent, `51093a2` CLI, `01ac0d7` issues, `f0008d9` README,
      `09cf2c4` guide JSON layout. Not pushed yet.
- [x] Site, uncommitted in its worktree: `app/playground/agent.ts`,
      Playground/SubmitDialog/route/CSS, `scripts/agent-docs.ts` (+ postbuild),
      `tests/playground-agent.spec.ts` (11/11 in Chrome with WebGPU), README.

## Open questions for the user

1. **WebMCP origin-trial token** for empyreangate.org (and dev.empyreangate.org):
   registering at developer.chrome.com/origintrials needs your Google
   account. Without it, WebMCP works only for people with the Chrome flag
   on; `window.empyrean`, links and docs work everywhere regardless.
   Recommendation: register both origins once this ships.

## Things not to do

- Don't bump `bun.lock` by hand; the bot does it.
- Don't let any tool submit to the crew's queue.
- Don't push the site's `master`.
