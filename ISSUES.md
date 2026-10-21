# Issues

Known problems not yet picked up. Each entry is enough to start from; claim
one by marking it `in progress — <thread/branch>` before working on it.

## Home-page render is the mirror image of the gate's own preview

- **What:** `app/gate/shaders.ts` places spoke `s` at screen
  `rn * (sin θ, cos θ)` with `θ = s / spokes · τ` (spoke 0 at the top,
  numbered clockwise). The gate's operator preview
  (`src/GateCanvas.tsx` in TomSawyerLabs/empyrean-gate) places it at
  `(cos(θ − π/2), sin(θ − π/2)) = (sin θ, −cos θ)` in GL's y-up space:
  spoke 0 at the bottom, counter-clockwise. The two are mirror images across
  the horizontal axis, so an asymmetric pattern (a spiral, a chase) turns the
  other way on the home page than on the gate's screen.
- **Why it matters:** the `/playground` render follows the gate's convention
  (so submitted patterns look as they will on the gate). The home page and
  the playground now disagree, and `fromScreen` in `app/gate/geometry.ts`
  encodes the home page's convention.
- **To decide first:** which view is "right" (the gate is overhead; seen from
  beneath it is mirrored relative to a top-down drawing). Possibly the gate's
  preview should be the one to change.

## Right after a deploy, a page can hang because its build manifest 404s

- **What:** twice on the `dev` Preview (2026-10-15, builds `b8afb20` and
  `62a756a`), a browser load within a minute or two of Workers Builds
  reporting success got `404` for `/assets/manifest-<hash>.js` — the hash the
  freshly served HTML referenced — while other requests for the same URL
  already got `200`. React Router never hydrates without it, so the page
  stays on its prerendered shell (the playground: "Loading the gate's editor
  and render engine…") until reloaded. A reload a minute later worked both
  times.
- **Why it matters:** any visitor landing in that window after any deploy
  (production too, presumably) sees a page that never finishes loading, with
  no error and no retry.
- **To look at:** whether new HTML can reach an edge before its assets do,
  and whether that 404 gets cached; and a client-side safeguard (e.g. retry
  or reload once when the manifest / entry module fails to load).

## The "Play it live" home test fails on WebKit under a full parallel run

- **What:** `tests/home.spec.ts:74` ("offers Play it live, and what is on,
  only while the gate answers") fails on `[webkit]` when the whole home suite
  runs (twice in a row on 2026-10-18, dev at `c872052`), and passes when run
  alone (`--project=webkit -g "Play it live" --repeat-each=2`). Error:
  `locator('.hero-actions').getByRole('link', { name: 'Play it live ↗' })`,
  "element(s) not found" after 5 s. It passed in the full suite an hour
  earlier, at `2c089b8`.
- **Why it matters:** a red suite hides real failures and trains people to
  ignore it.
- **To look at:** whether the mocked `/api/live` route is in place before the
  page's first fetch on WebKit, or the 5 s wait is too short under load.
- **Also (2026-10-19, dev at `a8e6372`):** fails on `[firefox]` too (35 s,
  same assertion) when only `home.spec.ts` and `render.spec.ts` run together.

## Hero render tests fail on Firefox and WebKit when run with the home suite

- **What:** `npx playwright test tests/home.spec tests/render.spec` on dev
  `a8e6372` (2026-10-19): `render.spec.ts:13` ("reaches a live state, or
  falls back on purpose", firefox), `:51`/`:68` (pause and play, webkit,
  firefox) and `:89` ("respects prefers-reduced-motion by starting paused",
  webkit), each `expect(locator).toHaveAttribute(...)` failing; which ones
  vary run to run.
- **Why it matters:** same as above; the full three-browser suite is never
  green locally.

## Two playground tests flake on WebKit under a parallel run

- **What:** `tests/playground.spec.ts:321` ("edits are kept in the browser
  across reloads", failing at line 327) and `:336` ("a patch that cannot run
  says so", failing at line 344: `expect(page.locator(".pnode"))
.toHaveCount(before - 1)`) failed on `[webkit]` in a full
  `bunx playwright test playground` run on 2026-10-18 (branch `dj-sim`, off
  dev `68b0fd2`). Re-run alone with `--project=webkit --repeat-each=3`, the
  first failed once in three and the second passed every time. Chromium and
  Firefox pass.
- **Why it matters:** the same as the "Play it live" entry above: a red
  suite hides real failures.
- **To look at:** both change the graph right after the editor loads (one
  adds a node and reloads, the other deletes one) and then count `.pnode`;
  whether WebKit under load is slower than the default 5 s wait there.

## Two playground tests fail every time on Firefox/WebKit at dev `ee557a2`

In progress — arrange-tests (the arranged presets open cropped: the editor gets a lower minZoom, and the tests fit the view before clicking).

- **What:** on dev `ee557a2` (web-dist `c7b55cc`, "the built-in patches are
  laid out as Arrange leaves them"), 2026-10-21, both alone and in the full
  suite:
  - `tests/playground.spec.ts:451` ("a patch that cannot run says so"),
    `[firefox]` and `[webkit]`: the click on
    `.pnode` with text "Output" (line 457) retries until timeout with
    "element is outside of the viewport".
  - `tests/playground-navigation.spec.ts:76` ("a double-clicked Sub-patch
    has a URL; Back comes out of it"), `[webkit]`: `toHaveURL` fails.
    Chromium passes both.
- **Why it matters:** not a flake like the entry above: these fail on
  every run, so the three-browser suite is red on dev.
- **To look at:** whether the new layout puts Output off-canvas at the
  test's window size (scroll or fit-view before clicking), and the WebKit
  double-click.
