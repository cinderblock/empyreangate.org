# Pattern playground — the gate's node editor, in the browser

Status: **built and tested locally, nothing pushed.** Waiting on Cameron for
the pushes, the ops change and two wording/channel choices (see "Open
questions"). Gate branch `patch-crate` (8 commits), site branch `playground`
(3 commits), both in their own worktrees.

## Goal

Let anyone build their own gate pattern on empyreangate.org with the same
node-graph editor the gate's operators use, see it run live on a simulated
gate, keep their work (browser storage plus explicit save/load to disk), and
press **Submit** to send it to us for possible use on the real gate.

## Environment / context

| What                  | Where / value                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate software         | `C:\Users\camer\git\Personal Projects\Empyrean` (`github.com/TomSawyerLabs/empyrean-gate`, public), v0.14.0, commits straight to `master`       |
| Gate work happens in  | worktree `C:\Users\camer\.t3\worktrees\Empyrean\playground`, branch `patch-crate`, PR into gate `master`                                        |
| Site work happens in  | worktree `C:\Users\camer\.t3\worktrees\empyreangate.org\playground`, branch `playground` (off `dev`); `dev` itself only has plan/ISSUES commits |
| Editor UI             | `src/Patch.tsx` (780 lines, React Flow `@xyflow/react`)                                                                                         |
| Patch format          | `PatchDoc` JSON, `src-tauri/src/patch/mod.rs:63-153`, TS mirror `src/types.ts:1032-1115`                                                        |
| Node definitions      | `src-tauri/src/patch/registry.rs` (1009 lines); palette JSON served at `GET /patch/registry`                                                    |
| Evaluation            | Rust only: `patch/eval.rs` (CPU scalar/event nodes) + `patch/codegen.rs` (graph → one WGSL compute shader) + `engine/shaders/patch_lib.wgsl`    |
| GPU ABI               | `engine/mod.rs:30` `Globals`, `:93` `AudioUniform`; `layers.rs:531` `GpuDab`, `:548` `GpuEffect`; `MAX_EFFECTS` 32, `MAX_DABS` 512              |
| Effects lifecycle     | `engine/mod.rs:~3044-3080`: emitted effects are aged by wall clock, dropped after `duration` (or kind default), packed to `GpuEffect`           |
| Layout                | 64 spokes × 378 px = 24,192 LEDs, radial, parametric (`config.rs:17-50`)                                                                        |
| Site's current render | WebGL2 port of the _layer_ shader (`app/gate/shaders.ts`, `engine.ts`, `GateRender.tsx`), not the patch path                                    |
| Site hosting          | Cloudflare Workers static assets, **no Worker script**, provisioned by the ops repo                                                             |

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

1. Gate: extract `crates/empyrean-patch`. **Done** (`4a44e9d`).
2. Gate: `crates/empyrean-patch-wasm` + `sim::Sim`. **Done** (`dfb40f0`);
   audio analysis + `MINI_PIXELS` into the crate (`93cf750`).
3. Gate: `packages/patch-web` runtime. **Done** (`832abe5`, `1bb98db`);
   verified in Chrome: all 14 presets compile and animate, effects flash and
   decay, thumbnails/meters fill.
4. Gate: editor behind `PatchStore`, app switched. **Done** (`832abe5`).
   Layout gate (131), behaviour suite (114), Rust lib (333) and crate (54)
   tests pass.
5. Gate: Import / Export in the Patch tab. **Done** (`832abe5`).
6. Gate: CI job + `web-dist` workflow + docs. **Done** (`1b39f46`,
   `f5e32e5`, `35be3f5`).
7. Site: `/playground`. **Done** (`299ae04`): IndexedDB library, starter
   preset, presets, Save to disk / Open file, tap/draw tools, synthetic beat
   or mic, stand-in DJ deck, video/image, phone motion, master; no-WebGPU
   fallback. Verified in Chrome (live preview, knob edits keep phases,
   reload keeps edits).
8. Site: Submit. **Code done** (`7bdbe7a`): Worker + dialog + Turnstile,
   tested end to end with `wrangler dev` and Turnstile test keys. **Going
   live needs** the ops bucket, a Turnstile widget and the worker secret.
9. Site: README (`011f82a`) and tests (`tests/playground.spec.ts`; 156/156
   across three browsers). **Done.**
10. **[current, blocked on Cameron]** Ship, in this order:
    a. Push gate `patch-crate`, open the PR, merge; CI publishes `web-dist`.
    b. Site: switch the dependency to
    `github:TomSawyerLabs/empyrean-gate#web-dist`, re-run checks, push
    `playground`, check its Preview at `playground.empyreangate.org`.
    c. Ops: create the bucket (below); Turnstile widget; set
    `TURNSTILE_SECRET` on the worker; put the site key in
    `app/content/site.ts`.
    d. Merge `playground` into `dev`. The R2 binding makes `wrangler deploy`
    fail until the bucket exists, so c comes before d.

### Staged ops change (not applied; needs an explicit yes)

`cloudflare/config/projects/empyreangate.yaml` in the ops repo, a new list
entry. That file currently has **another thread's uncommitted edits**
(removing the `previews:` block) in the shared ops checkout; this change
would go on top of whatever that becomes.

```yaml
# Pattern-playground submissions: one JSON object per submission, written by
# the site's Worker (worker/index.ts in the site repo, binding SUBMISSIONS).
# wrangler deploy fails on a missing bucket rather than creating one, so this
# must exist before the site's wrangler.jsonc carrying the binding deploys.
- r2: empyreangate-submissions
```

Not in ops today: Turnstile widgets (no schema support) and worker secrets.

## Progress log

- [x] Survey gate repo's patch system and the site's render (2026-10-14)
- [x] Decisions on the five open questions (2026-10-14)
- [x] Steps 1–6 in the gate worktree (branch `patch-crate`, not pushed)
- [x] Gate README / node-graph plan paths updated
- [x] Steps 7–9 on the site (branch `playground`, not pushed)
- [ ] Push `patch-crate` + PR (needs Cameron's OK)
- [ ] Site dependency to `web-dist`, push `playground` (after the gate merge)
- [ ] Ops: submissions bucket (staged above; needs a yes)
- [ ] Turnstile widget + `TURNSTILE_SECRET` + site key
- [ ] Merge `playground` into `dev`

## Open questions for the user

1. **Push the gate branch and open the PR** into TomSawyerLabs/empyrean-gate
   `master`? (8 commits; restructures the repo as agreed.) Recommend yes.
2. **Apply the staged ops change** (the R2 bucket above)? It has to wait for
   or sit on top of the other thread's uncommitted `empyreangate.yaml` edit.
3. **Turnstile widget**: create it in the dashboard (hostname
   `empyreangate.org`) and hand over the site key, or add Turnstile support
   to ops? Recommend the dashboard: one widget, rarely changes. Either way
   `TURNSTILE_SECRET` has to be set on the `empyreangate-org` worker
   (`wrangler secret put`), by Cameron or by me with a yes.
4. **Submission terms wording.** Draft (`PLAYGROUND.terms`): "I made this
   pattern (or have the right to share it), and I'm happy for the Entheos
   crew to play it on The Empyrean Gate and to share it, credited to me."
   Name a license (MIT like the gate, or CC BY)?
5. **Notifications**: where should a new submission ping? The Worker
   supports a Discord/Slack-style webhook (`NOTIFY_WEBHOOK`); none is set.

## Findings / gotchas

- **`cargo fmt` in `src-tauri` reformats dozens of untouched files**: the
  gate repo is not rustfmt-clean and has no rustfmt.toml. Format only new
  files with `rustfmt <file>`.
- **A revert loop over `git diff --name-only` also hits staged renames** and
  wipes edits in moved files. Recovered via the safety stash.
- **The machine's cargo `build-dir` is shared** (`~/.cargo/build`), so the
  worktree reuses the main checkout's compiled deps; no
  `CARGO_TARGET_DIR` games needed.
- **A hidden Chrome tab runs no `requestAnimationFrame` and throttles
  timers to ~1 Hz.** When testing the runtime from the extension, drive
  frames by hand (`rt.frame(t)` with a synthetic 60 fps clock); otherwise
  effects look broken because each frame's dt clamps to 0.5 s.
- **WebGPU `layout: "auto"` drops bindings the shader doesn't use**, so the
  runtime uses an explicit bind group layout with all eight bindings.
- **The wasm is ~790 KB uncompressed** (rustfft is most of the growth).
  Fine for now; `wasm-opt` is an easy later win.
- The TS `PatchShape` was missing `effects`; fixed in the package types.

- **The site's `* { margin: 0; padding: 0 }` reset** would flatten the shared
  editor's controls; the editor's zero-specificity skin loads later and wins.
- **Vite won't serve files outside the project in dev**, so a `file:`-linked
  local package's wasm gets a 403; `PATCH_WEB_DIR` widens `server.fs.allow`.
  Pre-bundling would also break the wasm URL, so the package is in
  `optimizeDeps.exclude`.
- **Bun's lockfile stores `file:` dependencies as paths relative to the
  checkout**, so the same lock breaks in a worktree at a different depth.
  Moot once the dependency is `github:...#web-dist`.
- **The WebKit reduced-motion home test flakes under CPU load** (hydration
  takes ~2.7 s there; it passes 10 s when a dev server and a WebGPU tab are
  also running). Not caused by this work: 10/10 on a quiet machine.
- **The gate's preview is the mirror image of the site's home-page render.**
  The playground follows the gate (ISSUES.md has the home page).

## Things not to do

- Don't hand-port codegen or the evaluator to TypeScript. Everything that
  knows a GPU layout lives in Rust and crosses to JS as bytes.
- Don't force-push `web-dist`; CI appends.
- Don't touch Cloudflare/ops for the submit endpoint without per-change
  approval.
- Don't do the gate work in the main Empyrean checkout; it's shared with
  other threads. Use the `playground` worktree. Same for the site: the
  playground stays on its own branch/worktree until its dependency points at
  `web-dist`, because a `file:` path would break CI and Workers Builds.
- Don't run `cargo fmt` over `src-tauri`; format only new files.
- Don't merge the site's `playground` branch before the R2 bucket exists.
