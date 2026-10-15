# Pattern playground — the gate's node editor, in the browser

Status: **proposal, not started.** Waiting on the open questions below.

## Goal

Let anyone build their own gate pattern on empyreangate.org with the same
node-graph editor the gate's operators use, see it run live on a simulated
gate, keep their work (browser storage plus explicit save/load to disk), and
press **Submit** to send it to us for possible use on the real gate.

## Environment / context

| What                  | Where / value                                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate software         | `C:\Users\camer\git\Personal Projects\Empyrean` (`github.com/TomSawyerLabs/empyrean-gate`), v0.14.0                                          |
| Editor UI             | `src/Patch.tsx` (780 lines, React Flow `@xyflow/react`)                                                                                      |
| Patch format          | `PatchDoc` JSON, `src-tauri/src/patch/mod.rs:63-153`, TS mirror `src/types.ts:1032-1115`                                                     |
| Node definitions      | `src-tauri/src/patch/registry.rs` (1009 lines); palette JSON served at `GET /patch/registry`                                                 |
| Evaluation            | Rust only: `patch/eval.rs` (CPU scalar/event nodes) + `patch/codegen.rs` (graph → one WGSL compute shader) + `engine/shaders/patch_lib.wgsl` |
| Layout                | 64 spokes × 378 px = 24,192 LEDs, radial, parametric (`config.rs:17-50`)                                                                     |
| Site's current render | WebGL2 port of the _layer_ shader (`app/gate/shaders.ts`, `engine.ts`, `GateRender.tsx`), not the patch path                                 |
| Site hosting          | Cloudflare Workers static assets, **no Worker script**, provisioned by the ops repo                                                          |

## Findings that shape the design

- **The patch compiler is already pure Rust.** `registry.rs`, `validate.rs`
  and `codegen.rs` depend only on `std` and `serde`. `eval.rs` pulls in three
  small types from the engine (`AudioUniform`, `EffectCfg`/`EffectKind`,
  `DJ_EVENT_COUNT`). Moving the `patch` module into its own crate that
  compiles to `wasm32` is a small refactor, not a rewrite.
- **The output is WGSL**, which WebGPU runs natively. The same generated
  shader that drives the real gate can drive the browser preview, so the
  preview is exact, not an approximation.
- **The editor is barely coupled to Tauri.** `Patch.tsx` makes no `invoke()`
  calls; it talks to `GateClient` (WebSocket messages `patch_list/get/save/
delete/activate/param`) and fetches `/patch/registry` and `/patch/presets`.
  An adapter that implements those against local storage is enough.
- **Patches are data, not code.** A submission is bounded JSON (≤256 nodes,
  ≤1024 edges) that the gate re-validates before use. Accepting them from
  strangers carries no code-execution risk.
- **Host-tied inputs** need browser stand-ins: `audio` / `waveform` /
  `spectrum` (mic via Web Audio; the gate app already does browser-mic
  feature extraction in `src/Media.tsx`), `imu` (DeviceOrientation, or
  sliders on desktop), `dj_link` (a fake deck with BPM/phrase sliders),
  `video_in` / `image_in` (local file only; no yt-dlp proxy), and
  `tap` / `effects_in` / `touch_dabs` (local buttons and touches).
- **The gate app has no patch import/export UI today.** Copying a JSON file
  into `%APPDATA%/EmpyreanGate/patches/` is the only import path.
- **Side note, not this task:** `presets/dj-stereo-master-flow.json` is not
  listed in `presets.rs` `SOURCES`, so it never ships. Belongs in the gate
  repo's ISSUES.md.

## Proposed architecture (recommended)

1. **`empyrean-patch` crate** in the gate repo: `mod.rs` types, `registry`,
   `validate`, `codegen`, `eval`, with no engine/Tauri dependencies. The
   desktop app depends on it; a `wasm-bindgen` build exposes `registry()`,
   `validate(doc)`, `compile(doc) -> {wgsl, layout}` and a stepping `eval`.
   One source of truth: a new node added to the gate appears in the
   playground on the next build.
2. **Shared editor package** extracted from `Patch.tsx`, taking a storage /
   runtime adapter instead of `useGate()`. The gate app and the site both
   consume it.
3. **Browser runtime** on the site: WebGPU device, the generated compute
   shader plus `patch_lib.wgsl`, the same param/global buffer layout, and the
   site's existing soft-dot point renderer drawing the 24,192 LEDs.
   WebGPU-only with a clear message elsewhere (the editor is a desktop-class
   tool; the site's existing WebGL2 render stays for the home page).
4. **Persistence:** autosave to IndexedDB (a library of patches, not one
   slot); **Save to disk** via the File System Access API where available,
   download fallback elsewhere; **Open from disk** via file picker / drag-drop.
   Files are the exact `PatchDoc` JSON the gate reads, so a saved file drops
   straight into the gate's `patches/` folder.
5. **Submit:** needs a server, which the site does not have. Recommended: a
   small Worker route (POST JSON + name/contact + Turnstile) storing to R2 or
   D1 as a moderation queue, with a notification to us. This is an
   infrastructure change through the ops repo and needs explicit approval
   when we get there.
6. **Gate-side import:** an "Import patch" in the gate app (file or pasted
   JSON), so reviewing a submission is one click.

## Open questions for the user

1. **Single source of truth via WASM, or a hand-written TS port?**
   Recommend WASM: a TS port of `codegen.rs` (1406 lines) would drift every
   time a node is added.
2. **How should the site consume the editor and the WASM build?** Options: a
   published npm package from the gate repo, a git dependency, or a build
   step that pulls a release artifact. Recommend an npm package published from
   the gate repo's CI (versioned alongside the app).
3. **Submission backend:** Worker + R2/D1 + Turnstile (recommended), versus
   something with no server of ours (pre-filled GitHub issue, email link).
4. **Is the gate repo (TomSawyerLabs org) OK to restructure** into a crate +
   shared package? Allison is a major contributor there.
5. **WebGPU-only acceptable?** Desktop Chrome/Edge/Safari and recent
   Firefox have it; older phones won't. Recommend yes.

## Progress log

- [x] Survey gate repo's patch system and the site's render (2026-10-14)
- [ ] Answers to the open questions
- [ ] Everything else

## Things not to do

- Don't hand-port the shader codegen to TypeScript without a decision on Q1.
- Don't touch Cloudflare/ops for the submit endpoint without per-change
  approval.
