# Pattern playground — the gate's node editor, in the browser

Status: **in progress.** Decisions locked 2026-10-14; current step is marked
below.

## Goal

Let anyone build their own gate pattern on empyreangate.org with the same
node-graph editor the gate's operators use, see it run live on a simulated
gate, keep their work (browser storage plus explicit save/load to disk), and
press **Submit** to send it to us for possible use on the real gate.

## Environment / context

| What                  | Where / value                                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate software         | `C:\Users\camer\git\Personal Projects\Empyrean` (`github.com/TomSawyerLabs/empyrean-gate`, public), v0.14.0, commits straight to `master`    |
| Gate work happens in  | worktree `C:\Users\camer\.t3\worktrees\Empyrean\playground`, branch `patch-crate`, PR into gate `master`                                     |
| Editor UI             | `src/Patch.tsx` (780 lines, React Flow `@xyflow/react`)                                                                                      |
| Patch format          | `PatchDoc` JSON, `src-tauri/src/patch/mod.rs:63-153`, TS mirror `src/types.ts:1032-1115`                                                     |
| Node definitions      | `src-tauri/src/patch/registry.rs` (1009 lines); palette JSON served at `GET /patch/registry`                                                 |
| Evaluation            | Rust only: `patch/eval.rs` (CPU scalar/event nodes) + `patch/codegen.rs` (graph → one WGSL compute shader) + `engine/shaders/patch_lib.wgsl` |
| GPU ABI               | `engine/mod.rs:30` `Globals`, `:93` `AudioUniform`; `layers.rs:531` `GpuDab`, `:548` `GpuEffect`; `MAX_EFFECTS` 32, `MAX_DABS` 512           |
| Effects lifecycle     | `engine/mod.rs:~3044-3080`: emitted effects are aged by wall clock, dropped after `duration` (or kind default), packed to `GpuEffect`        |
| Layout                | 64 spokes × 378 px = 24,192 LEDs, radial, parametric (`config.rs:17-50`)                                                                     |
| Site's current render | WebGL2 port of the _layer_ shader (`app/gate/shaders.ts`, `engine.ts`, `GateRender.tsx`), not the patch path                                 |
| Site hosting          | Cloudflare Workers static assets, **no Worker script**, provisioned by the ops repo                                                          |

## Decisions already made (don't re-ask)

- **WASM build of the real Rust compiler/evaluator**, not a TS port (Cameron,
  2026-10-14). One source of truth; nodes added to the gate appear in the
  playground on the next build.
- **The site consumes the gate's web package as a git dependency**, not an
  npm package (Cameron: "npm seems heavy"). Because the package contains
  built artifacts (wasm, JS), the gate repo's CI builds it and commits it to
  a `web-dist` branch (append-only, never force-pushed); the site pins a
  `web-dist` commit in `bun.lock`.
- **Submit = Worker + R2/D1 + Turnstile** (Cameron: "sounds great"). Still
  needs per-change approval for the ops-repo / Cloudflare part.
- **Restructuring the gate repo is fine** (Cameron: "yes. boil the ocean").
  Do it properly: crate split, shared editor package, gate-side import.
- **WebGPU-only** for the playground (Cameron: "yes"). The home page's
  WebGL2 render stays.

## Findings that shape the design

- **The patch compiler is already pure Rust.** `registry.rs`, `validate.rs`
  and `codegen.rs` depend only on `std` and `serde`. `eval.rs` pulls in three
  small types from the engine (`AudioUniform`, `EffectCfg`/`EffectKind`,
  `DJ_EVENT_COUNT`). `presets.rs` is `include_str!` of JSON. All portable.
- **The output is WGSL**, which WebGPU runs natively, and `patch_lib.wgsl`
  is self-contained: bindings 0 (Globals uniform), 1 (4× AudioU uniform),
  3 (FX), 4 (OUT, packed RGB u32), 5 (DABS), 6 (SCOPE: 4 × (256 wave + 64
  spectrum) f32), 7 (VIDEO u32), 8 (P, the param slab). Entry point `main`,
  `@workgroup_size(256)`, one invocation per LED. The preview module (one
  thumbnail per field node, up to 32) uses the same bindings.
- **WGSL `Globals` names two fields `_pad_game0/1`** where Rust has
  `game_style`/`game_turn`. Same layout, harmless.
- **The editor is barely coupled to Tauri.** `Patch.tsx` makes no `invoke()`
  calls; it uses `useGate()` (`client`, `config`, `status`, `connected`),
  `GateClient` messages `patch_list/get/save/delete/activate/param`, fetches
  `/patch/registry` and `/patch/presets`, and `MiniViz`/`miniPreview` for
  thumbnails fed by a binary preview stream.
- **Patches are data, not code.** A submission is bounded JSON (≤256 nodes,
  ≤1024 edges) that the gate re-validates before use.
- **Host-tied inputs** need browser stand-ins: `audio` / `waveform` /
  `spectrum` (mic via Web Audio; the gate app already does browser-mic
  feature extraction in `src/Media.tsx`), `imu` (DeviceOrientation, or
  sliders on desktop), `dj_link` (a fake deck), `video_in` / `image_in`
  (local file only), `tap` / `effects_in` / `touch_dabs` (local input).
- **The gate app has no patch import/export UI today.**
- **Side note, not this task:** `presets/dj-stereo-master-flow.json` is not
  listed in `presets.rs` `SOURCES`, so it never ships. Goes in the gate
  repo's ISSUES.md.

## Architecture

Gate repo (`empyrean-gate`):

1. **`crates/empyrean-patch`** (pure Rust, no engine/Tauri deps): document
   types, `registry`, `validate`, `codegen` (+ `patch_lib.wgsl`), `eval`,
   `presets`, the effect types (`EffectKind`, `EffectCfg`), and the GPU ABI
   structs the patch shader reads (`Globals`, `AudioUniform`, `GpuEffect`,
   `GpuDab`, limits). The app's `src-tauri` depends on it by path and
   re-exports, so nothing else in the engine changes shape. The on-disk store
   (`store.rs`) stays in the app.
2. **`crates/empyrean-patch-wasm`** (`wasm-bindgen`): `registry()`,
   `presets()`, `validate(doc)`, and a `Sim` that owns a compiled patch, the
   evaluator, the live effect list and the frame packing. Each frame JS calls
   `sim.frame(dt, inputs)` and uploads the returned byte views (Globals,
   audio, FX, slab) as-is, so **Rust owns every GPU layout**.
3. **`packages/patch-web`** (TS, built with Vite library mode): the WebGPU
   runtime (device, pipelines for main + preview modules, buffers, point
   renderer), browser input adapters (mic, orientation, fake DJ deck, local
   video), and the editor extracted from `Patch.tsx` behind a
   `PatchHost` adapter interface (list/load/save/delete/activate, registry,
   presets, mini-preview frames, param play). Ships the wasm.
4. **The gate app consumes `packages/patch-web`'s editor** through a
   `GateClient`-backed `PatchHost`. Adds **Import / Export patch** (file,
   paste).
5. **CI** builds the wasm + package and appends a commit to `web-dist`.

Site repo (`empyreangate.org`):

6. **`/playground` route**: the editor with a local `PatchHost` (IndexedDB
   library, autosave), the browser runtime for the live preview and mini
   thumbnails, Save to disk (File System Access API, download fallback),
   Open from disk (picker / drag-drop), presets as starting points, WebGPU
   check with a clear message.
7. **Submit**: Worker route `POST /api/submit` (JSON + name + optional
   contact + Turnstile token) → validate (size, schema; full validation via
   the same wasm if practical) → R2 object + D1 row as moderation queue →
   notification. Needs ops changes, staged for approval.

## Plan / steps

1. **[current]** Gate: extract `crates/empyrean-patch`; app builds and all
   existing Rust tests pass unchanged.
2. Gate: `crates/empyrean-patch-wasm` with `Sim`; a Rust test that the
   packed byte layouts match the engine's structs.
3. Gate: `packages/patch-web` runtime — render a preset in a bare test page
   with WebGPU, compare against the engine's output if practical (the
   `engine-smoke` binary can dump frames).
4. Gate: extract the editor into `packages/patch-web`, switch the app to it,
   behavior specs (`test:behavior`, patch-zoom etc.) still pass.
5. Gate: Import / Export in the app.
6. Gate: CI job → `web-dist` branch. README. PR to gate `master`.
7. Site: `/playground` route with local storage, disk save/open, presets.
8. Site: Submit UI + Worker (stage ops change, wait for approval).
9. Site: README, tests, preview deploy check.

## Progress log

- [x] Survey gate repo's patch system and the site's render (2026-10-14)
- [x] Decisions on the five open questions (2026-10-14)
- [ ] Step 1: patch crate
- [ ] Steps 2–9

## Open questions for the user

None right now. The ops change for Submit will need an explicit yes when
staged.

## Things not to do

- Don't hand-port codegen or the evaluator to TypeScript. Everything that
  knows a GPU layout lives in Rust and crosses to JS as bytes.
- Don't force-push `web-dist`; CI appends.
- Don't touch Cloudflare/ops for the submit endpoint without per-change
  approval.
- Don't do the gate work in the main Empyrean checkout; it's shared with
  other threads. Use the `playground` worktree.
