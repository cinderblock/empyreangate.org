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
