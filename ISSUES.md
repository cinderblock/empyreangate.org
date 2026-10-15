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
