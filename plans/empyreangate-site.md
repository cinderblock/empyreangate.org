# empyreangate.org — the site

## Goal

A high-quality public website for The Empyrean Gate at `empyreangate.org`,
first-class on phones and desktops, that ranks for the piece's name, tells its
story, links the open-source software, shows photos, and carries a live,
interactive, locally rendered version of the gate's light patterns.

## Environment / context

| What                | Where / value                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Repo                | `github.com/cinderblock/empyreangate.org`, branch `master`                                                            |
| Checkout            | `C:\Users\camer\git\Personal Projects\empyreangate.org`                                                               |
| Template            | `cinderblock/ssg-base` (first commit is the pristine template)                                                        |
| Deploy              | Cloudflare Workers Builds (Cloudflare's CI), static assets, no Worker script                                          |
| Domains / redirects | `github.com/cinderblock/ops`, `cloudflare/config/projects/empyreangate.yaml`, plan `plans/empyreangate-site.md` there |
| Gate software       | `github.com/TomSawyerLabs/empyrean-gate`, local `C:\Users\camer\git\Personal Projects\Empyrean`                       |
| Worker name         | `empyreangate-org` (must match ops)                                                                                   |

## Decisions already made (don't re-ask)

- **Start from ssg-base; Workers static assets, not Pages; Workers Builds
  deploys, GitHub only checks.** No Cloudflare secret in GitHub.
- **Redirects live in ops, not in a worker script.** The site is assets-only.
- **Dark only.** The piece exists at night; a light theme would be a second
  design for no one. `color-scheme: dark`.
- **Single page + a real `/404`.** Content is thin until the photos and
  confirmed years arrive; sections with anchors beat five sparse pages.
- **Prose is data** (`app/content/*.ts`), as in hyparhuts.org, so copy can be
  edited without touching layout.
- **The live render is a WebGL2 port of the engine's own layer shader**, not a
  wasm build and not a stream from a real backend. See "The render" below.
- **Original-design credit is one line of names.** Nothing else about it
  anywhere on the site or in this repo.
- **No third-party embed services** for Instagram (Behold, Elfsight, etc.).
  Anything that pulls from Instagram is our own code against Meta's API.
- **Instagram integration is deferred** (Cameron, 2026-10-11). The page links
  `@entheosrising` and names no hashtag until one is chosen.
- **Photo originals are committed** in `photos/` (Cameron: "we won't have too
  many"). Web renditions are generated at build time, not committed.
- **The fire is worded ambiguously** (Cameron, 2026-10-11): the cauldron may or
  may not travel, so the copy says "the fire beneath it" and lets that be the
  cauldron or the people. The piece section says both outright.
- **Timeline entries carry months** (Burning Man Aug–Sep, unSCruz May, Love
  Burn Feb) with an ISO `date` for the first day.
- **Names and ordering** (Cameron, 2026-10-14): crew shows "James
  Logistic" and 'Cameron "Quadrangle" Tacklind'. Earlier contributors run
  most recent first, and the 2022 design credit names Anthony Fieldman
  alone: James is still involved and is credited only as crew. The earlier
  roles don't say "original" (Cameron, 2026-10-14): "Lighting, 2022",
  "Design, 2022".
- **Contributor links** (Cameron, 2026-10-12): each person links to their own
  site where they have one: Cameron, Ted, Allison (GitHub `allibell`, the
  gate software's second-largest contributor), Anthony Fieldman, Eric
  Vicenti (`eric.vicenti.net`, from his GitHub profile). The 2022
  fabrication and lighting credits link their studios (Kennedy
  Fabrications, Sight Unseen Studios), as Entheos' own gate page does. James
  Tramel and the fabricators individually have no site of their own found.
  This supersedes "original-design credit is one line of names". Eric's
  line also links his unSCruz 2024 software, Uprising
  (github.com/ericvicenti/uprising), as its byline (Cameron, 2026-10-14).
- **People:** a names-only "The gate today" list (The Entheos Community, James
  Tramel, Cameron Tacklind, Allison Bellows, Theodore Wahrburg) and an
  "Earlier contributors" list with roles, where Eric Vicenti is credited for
  the unSCruz 2024 light software.

## The render

The engine (`src-tauri/src/engine/shaders/gate.wgsl` in the gate repo) is a
compute shader: `layer_color(L, ctx)` is a pure function of the LED's polar
position and a per-layer phase, blended across the stack, soft-clipped, then
written out over sACN. The browser UI there only displays streamed frames.

So the port is: the same per-pixel function as a **vertex shader**, one
invocation per drawn LED, positions derived from `gl_VertexID` (no attribute
buffers), drawing `gl.POINTS` with the operator UI's soft-dot fragment shader
and additive premultiplied blending on a transparent canvas.

Ported: Solid, GradientRadial, NoiseField, NoiseColor, RadialWaves, Spiral,
Plasma, SpokeChase, Sparkle, BeatRings, Breathe, Rainbow, Wedges,
Interference, Fire, Warp (15 kinds, numbered as the WGSL cases). Not ported:
Meteors, Waveform, Spectrum, Video, EntheosWeave, BrcMap, BrcPlan, GoldenRose,
the node-graph patches, game mode, effects and dabs.

CPU side (`app/gate/engine.ts`) mirrors `layers.rs`: phase is the integral of
`phase_rate * speed * master_speed`, Sparkle and Warp get `split_phase`,
parameters wander within `walk_amount` (standing in for the autopilot), and a
synthetic 122 BPM "audio" feature set feeds the audio terms. Scene changes
crossfade the way the engine does (outgoing stack / incoming stack / mix).

Interaction: pointer position tilts the noise/plasma fields (`tilt_amount`);
a tap drops an expanding ring at that polar position (the public floor's
ripple, re-done on the same geometry); chips switch scenes; Pause/Play.

Decimation: the strip is far denser than a screen, so draw
`round(span_px / 1.3)` of the 378 LEDs per spoke (min 32), dot size about
twice the spacing. DPR capped at 2. Pauses when off-screen, hidden tab, or
reduced motion. Falls back to a still SVG of 64 spokes without WebGL2.

## Plan / steps

1. [x] Clone ssg-base fresh; CI-only workflow; wrangler.jsonc; real `/404` +
       `404.html`; sitemap; robots.
2. [x] Port the shader + engine; unit tests for the engine.
3. [x] Content: hero, the piece, the light, timeline, photo slots, credits,
       footer, structured data (VisualArtwork + Event), OG/Twitter meta.
4. [x] Design: dark, Cormorant display + Inter body, sticky section heads on
       desktop, single column on phones.
5. [x] Tests: content, render states, responsive (no horizontal overflow at
       six widths), reduced motion, 404.
6. [x] Green locally (fmt, typecheck, 9 unit tests, 43 Playwright tests in
       chromium); visual pass at 393 px and 1440 px; `public/og.png` generated.
7. [x] `cinderblock/empyreangate.org` created and pushed (3 commits on the
       template, 2026-10-11); first CI run green.
8. [x] Connected by Cameron 2026-10-12. Connect Workers Builds for previews only (2026-10-12,
       Cameron: "don't publish anything real yet"). ops applied the domain
       config (`90efcf5`); the worker is ops' 503 stub. Cameron, in the
       dashboard: Workers & Pages → `empyreangate-org` → Settings → Builds →
       Connect → `cinderblock/empyreangate.org`, production branch `master`,
       build `bun install --frozen-lockfile && bun run build`, **deploy
       `bunx wrangler versions upload`** (uploads, never activates), preview
       command left at its default, build variables `BUN_VERSION=1.4.2` and
       `SKIP_DEPENDENCY_INSTALL=1`, Enable Preview Builds on.
       8a. [x] Previews live at `https://<branch>.empyreangate.org` (2026-10-12).
       The workers.dev Preview URL never worked (the worker's preview URLs are
       off and only a full `wrangler deploy` would apply `preview_urls`), so ops
       turned on preview routing for the custom domain instead (ops `102fbb9`,
       `worker: { previews: true }`). Verified: `https://dev.empyreangate.org`
       200 with `x-robots-tag: noindex`, robots.txt disallows all;
       empyreangate.org still the 503 stub; www still 301s.
       8b. [ ] **← current** Launch, when Cameron decides: fast-forward `master` to
       `dev` and push (needs the admin bypass on `master`'s protection). The
       deploy command is `npx wrangler deploy`, so that push publishes.
9. [ ] Verify live: `/`, `/nope`, both `www.` hosts and the `.com` apex.
10. [x] Photo pipeline: `photos/` originals → `bun run photos` (sharp) →
        `public/photos/` renditions + generated manifest; exercised with a
        synthetic rotated original, then removed.
11. [ ] Cameron drops the originals into `photos/`; point each slot's `asset`
        at a slug in `gallery.ts`.
12. [x] Regional years (unSCruz 2023–2025) and the crew list, from Cameron.
13. [x] Love Burn: once, 2024 (Cameron, 2026-10-12). Timeline is complete.

## Later

- Instagram hashtag feed. Meta's `ig_hashtag_search` / `recent_media` need an
  Instagram Business or Creator account linked to a Facebook Page, a Meta app,
  and App Review for _Instagram Public Content Access_ (+ `instagram_basic`);
  30 unique hashtags per rolling week per account; top/recent media only.
  Shape when wanted: a cron Worker in ops pulling the tag hourly into KV,
  served as JSON the page fetches, degrading to the curated gallery when
  empty. Needs a decision on which account owns the token and which hashtag.
- A separate interactive site running the full engine (`SITE.interactiveUrl`).

## Findings / gotchas

- `#version 300 es` vertex shaders can use `gl_VertexID`, `uint` and dynamic
  uniform-array indexing, which is all the port needs; no attribute buffers at
  all. A VAO must still be bound to draw.
- The engine's `hsv2rgb` uses `fract(h)`, so hue can be any real; the presets
  rely on that for hue wander.
- `vite preview` serves `/404` from the emitted `404.html`, so the Playwright
  404 test exercises the same file Cloudflare's `not_found_handling` will.
- TypeScript needs `@types/bun` and `"types": ["vite/client", "bun"]` for
  `bun:test` imports under `react-router typegen && tsc`.
- **Line endings are LF on disk**, not CRLF, despite `core.autocrlf=true`:
  oxfmt enforces LF and `bun run fmt` rewrites CRLF files. hyparhuts.org and
  ssg-base are the same. Don't "fix" this to CRLF; `fmt:check` would fail.
- Port 4173 (ssg-base's preview default) was already taken on this machine by
  another project, so this repo previews and tests on **4180**.
- Headless Chromium renders the WebGL dots noticeably dimmer than a real GPU
  (SwiftShader, no MSAA); brightness was tuned with that in mind (`u_master`
  1.25, dot size 3x spacing) and the soft clip keeps real GPUs from blowing out.

- **Workers Previews, not Version URLs, for branch builds.** `wrangler
preview` (Wrangler ≥ 4.135, open beta, launched 2026-09-22) gives a stable
  per-branch URL `<branch>-<worker>.<subdomain>.workers.dev` that sends
  `X-Robots-Tag: noindex`. It requires a `previews` block in wrangler.jsonc,
  even empty. Previews are public by default; Cloudflare Access can gate them.
- **The stub had workers.dev and preview URLs both off** (API, 2026-10-12:
  `{'enabled': False, 'previews_enabled': False}`; account subdomain
  `isozilla`). Wrangler ties preview URLs to `workers_dev` unless
  `preview_urls` is set, and other projects saw preview builds succeed with no
  URL because of it. So wrangler.jsonc sets `workers_dev: false` (no duplicate
  production hostname) and `preview_urls: true` explicitly. ops' worker
  resource carries only `{ name }`, so these flags don't fight the ops sync.
- **Workers Builds' image defaults to Bun 1.2.15**; `bun.lock` was written by
  1.4.2. Pin `BUN_VERSION` as a build variable or `--frozen-lockfile` may
  refuse the lockfile. The build-image docs also don't say whether `bun.lock`
  is detected for the automatic install, so that step is skipped
  (`SKIP_DEPENDENCY_INSTALL=1`) and the build command installs with Bun.
- **Pre-launch guard is the deploy command**, not branch discipline: master
  builds run `wrangler versions upload`, which uploads a version without
  activating it, so nothing reaches empyreangate.org even by accident.

- **Previews ignore `not_found_handling`** (open beta; cloudflare/workers-sdk
  issue 16047). A missing path on `dev.empyreangate.org` returns a bare 9-byte
  "Not found" instead of `404.html`, and `_headers` isn't applied to that
  response. Production honours both, so the launched site is unaffected.
  Don't build a workaround Worker for it.
- **Workers Builds preview builds do set `WORKERS_CI_BRANCH`** (to `dev`), so
  the noindex switch in `scripts/build-context.ts` works as designed.

- **Social cards on previews were blank** (2026-10-12): `og:image` named
  `https://empyreangate.org/og.png`, and production answers 503 until launch.
  Preview builds now point `og:url`/`og:image`/`twitter:image` at their own
  subdomain (`siteOrigin()` in `scripts/build-context.ts`, injected as
  `__SITE_ORIGIN__` via Vite `define`). Wrangler sends the raw branch name and
  Cloudflare derives the preview label server-side, undocumented; the label
  logic mirrors Wrangler's `sanitizeBranchName`, exact for plain names.
  Chat apps cache link previews, so re-check with a fresh message.

- **Accidental publish, 2026-10-14 18:00 UTC.** PR #1 (Allison's
  `codex/donate-section`) targeted `master`, the repo's default branch, and
  was merged. Workers Builds built `master@03e00ca` and ran **`npx wrangler
deploy`**: the dashboard deploy command was never changed to `bunx wrangler
versions upload`, so the pre-launch guard did not exist. Deployment
  `53944ab2` put version `a4fd0dcf` at 100%, replacing ops' stub (version
  `10afe06f`, deployment `d889a059`). What went live is `master`'s copy,
  14 commits behind `dev` (James Tramel beside Anthony on "Original design",
  no contributor links, no fire/month copy) plus the Donate section. Because
  `master`'s wrangler.jsonc predates `workers_dev: false`, the deploy also
  switched on `empyreangate-org.isozilla.workers.dev` (200) and workers.dev
  preview URLs. The custom domain and `dev.empyreangate.org` were unaffected.
  Production robots.txt is `Allow: /` with no noindex while it is up.
  **Resolved the same day** (Cameron's choices): rolled back in the dashboard
  to `10afe06f` ("Undo accidental PR #1 publish"; empyreangate.org back to
  503), production workers.dev route turned off (`enabled: false`; workers.dev
  preview URLs left on), `master` merged into `dev` (`70fc9f5`; no
  conflicts, so `master` is an ancestor of `dev` and launch is a
  fast-forward). Not done, deliberately: reverting the merge on `master`, and
  changing the deploy command. Cameron keeps `npx wrangler deploy` on master,
  so **any push to master publishes**. GitHub: default branch is now `dev`
  (PRs target it), and `master` is protected (1 approving review, admin
  bypass allowed, no force-push, no deletion). Cameron plans to switch the
  default back to `master` within a couple of days; drop the protection then
  too if it gets in the way.
- **Allison's PR #2** (favicon as a full circle of 64 spokes; sticky section
  headings no longer slide over cards) was retargeted from `master` to `dev`
  and merged there (`15bdfde`, 2026-10-14) after checks passed. Her branch
  `codex/favicon-previews` only holds screenshots for that PR's description
  and is deliberately not merged.
- **Git wrote CRLF files on Windows** (merge, checkout) despite oxfmt needing
  LF, failing fmt:check and the hook. `.gitattributes` `* text=auto eol=lf`
  (`c018b6b`) fixes it.

## Open questions for the user

None. Cameron, 2026-10-12: "stop asking." Remaining work waits on things he
will hand over unprompted (photos in `photos/`) or decide on his own (launch).

## Things not to do

- Don't add a deploy step with Cloudflare credentials to GitHub Actions.
- Don't rename `master`.
- Don't reference the original architect anywhere but the one credits line.
- Don't pull Instagram through a third-party widget/relay service.
- Don't use `title=` for tooltips; the chips use `aria-description`.
