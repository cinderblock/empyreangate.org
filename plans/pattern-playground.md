# Pattern playground — the gate's node editor, in the browser

Status: **on the site's `dev` Preview; Submit not live yet.** The phone layout
round (2026-10-16) is in `playground-mobile.md`, which also lists exactly
what Submit still needs.
Cameron: never push either repo's `master` (the site's production is not to
be published yet); `dev` is where to see it on the real deploy. Gate branches
`patch-crate` and `web-dist` are pushed (not merged); the site's `playground`
work is merged into and pushed with `dev`. Waiting on the ops change and two
wording/channel choices (see "Open questions").

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
| Site work happens in  | worktree `C:\Users\camer\.t3\worktrees\empyreangate.org\playground`, branch `playground`, now merged into `dev` (pushed)                     |
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
    a. **Done, partly**: gate `patch-crate` pushed (no PR yet; merging to
    gate `master` is Cameron's call). `web-dist` pushed, **built locally**
    (`83461fb`) because the publishing workflow only runs from gate
    `master`; once it is there CI appends to the same branch.
    b. **Done**: site depends on `github:TomSawyerLabs/empyrean-gate#web-dist`
    (lock pins `83461fb`); `playground` rebased onto `dev`, fast-forwarded,
    pushed (`b89bb39`). The R2 binding is commented out in wrangler.jsonc
    until the bucket exists.
    c. Ops: create the bucket (below); Turnstile widget; set
    `TURNSTILE_SECRET` on the worker; put the site key in
    `app/content/site.ts`.
    d. Uncomment the R2 binding in wrangler.jsonc once the bucket exists.
    Production (`master`) stays unpublished until Cameron says so.

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
- [x] Push gate `patch-crate` and a locally built `web-dist` (2026-10-15)
- [x] Site dependency to `web-dist`; `playground` merged into `dev`, pushed
- [x] `dev` Preview checked (dev.empyreangate.org/playground): Workers Builds green, editor + WebGPU render + thumbnails live, wasm 222 KB over the wire, `/api/submit` answers 503 as designed
- [x] Round 3 (2026-10-16): ten control-rate nodes (Map range, Mix, Clamp,
      Random, Counter, Toggle, Threshold, Delay, Merge events, Step sequencer)
      and the "Step and Sample" preset, gate `ff86e0f` → web-dist `2c3f88b`
      → `dev` `60ba775`; verified on the Preview. Plan:
      gate `plans/editor-round-3.md`. Per-node video: not built, see that
      plan's open question (video is one live host feed; a patch can't carry it).
- [x] Gate work on gate `master` (`3b5cc85`, 2026-10-15; Cameron: app master
      is fine to push). CI green; web-dist now built by CI (`f3c3891`), and
      the site depends on that build.
- [ ] Ops: submissions bucket (staged above; needs a yes)
- [ ] Turnstile widget + `TURNSTILE_SECRET` + site key
- [ ] Uncomment the R2 binding once the bucket exists

### Touch as nodes (2026-10-15)

Cameron: taps need their own representation in the nodes; users define their
own touch interactions, in the web editor and on the real gate. Built on the
gate branch (`plans/touch-nodes.md` there): Touch / Touch mask / Touch glow
nodes, raw touch from every gate surface and the playground, a patch with
touch nodes owns the surface, preset Touch Ripples. Site `b8afb20` (web-dist
`23e0ea7`) is on the dev Preview and checked there.

### Nothing reaches the output unless wired (2026-10-15)

Cameron noticed Touch Ripples' Event effect isn't wired to the Output yet its
bursts showed: the Output silently added every effect and pen stroke. Now
(his choice, "everything explicit", gate `plans/explicit-output.md`) effects
and strokes reach the output only through wired Render effects / Render
points; patch format 2, with older patches (gate store, presets, the
playground's IndexedDB, files) migrated on load. Site `107e84c` (web-dist
`dae67de`) on the dev Preview, checked there.

## Open questions for the user

1. **Cut a gate release?** The work is on gate `master`, but running gates
   only get it from a version tag (they self-update). Decompression is
   2026-10-17, so holding off until after is my recommendation.
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
- **Don't push `master` in either repo** (Cameron, 2026-10-15). Use `dev`.
- Don't add the R2 binding back before the bucket exists.
