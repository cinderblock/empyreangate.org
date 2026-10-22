# Node minis on a browser without WebGL2 or WebGPU

## Goal

A friend opening dev.empyreangate.org/playground saw no minis (the live
thumbnails, meters and event strips on editor nodes) on any patch. Find out
why, make the minis work where they can, and say clearly where they can't.

## Environment / context

- The friend's machine: Ubuntu 24 (Linux), 4K display, AMD GPU. Firefox's
  about:support lists the HDMI audio as Navi 21/23 (RX 6000-series); Cameron
  thought "an RX 9800 or similar". Stock Firefox, probably the snap, Mesa
  drivers (no proprietary ones).
- What it shows: WebGL1 only, WebGL2 "blocklisted" in about:support; the
  renderer string is Firefox's generic "Radeon R9 200 Series, or similar"
  (sanitized, not the real card). The playground shows the no-WebGPU notice.
- Minis need both halves: the WebGPU runtime computes their cells
  (`readPreview()` in the gate's `packages/patch-web/src/runtime`), and
  `MiniRenderer` (`src/editor/minis.tsx`) draws them. Without WebGPU there is
  no runtime, so no minis at all; scalars are CPU-evaluated (`eval.rs`) but
  only pushed by the runtime.
- Site worktree: `~/.t3/worktrees/empyreangate.org/minis-2d` (branch
  `minis-2d`, pushed as `dev`). Gate worktree:
  `~/.t3/worktrees/Empyrean/mini-2d-fallback`.

## Decisions already made (don't re-ask)

- Build the 2D-canvas fallback for drawing minis without WebGL2 (Cameron:
  "is it worth adding fallback support?", then went ahead).
- Reports should carry the browser's reason for refusing WebGL2 (Cameron:
  "sounds useful").
- A script for the friend to run on that machine (Cameron's idea). It ends
  with a short status: each problem, and a copyable command that fixes it.
  The friend is a Linux pro but new to GPUs, so it stays terse.
- The script recommends open-source packages only (the friend is an
  open-source enthusiast). AMD's firmware is closed: say when it's missing,
  never suggest installing it. Never suggest Chrome.

## Plan / steps

1. Done: minis draw on a 2D canvas without WebGL2.
2. Done: reports say why WebGL2 was refused.
3. Done: `scripts/linux-gpu-check.sh` for the friend. **Current: waiting on
   its output, or a report from that machine.**
4. Then, depending on what it shows: fix the setup there (Firefox pref,
   Mozilla's deb instead of the snap, a package), and/or the two open
   questions below.

## Findings / gotchas

- The 2D fallback alone did nothing for the friend: that Firefox has no
  WebGPU either, so no runtime and no minis. "Output still works" had been
  read as "WebGPU works", which was wrong.
- Firefox's WebGL renderer string is generic by default
  (`webgl.sanitize-unmasked-renderer`); it says nothing about the card.
- Headless Playwright Firefox reports "WebGPU is disabled by blocklist";
  headed with WebGPU forced on, the minis work.
- The friend's console errors were not ours: Cloudflare Insights beacon
  CORS/SRI (a Cloudflare setting, off-limits without authorization) and a
  `file:///` security error that matches nothing in the build (likely an
  extension).
- Locally, Playwright's Firefox and WebKit fail every `tests/failures.spec.ts`
  test with "Navigation … is interrupted by another navigation", changes or
  not; CI runs Chromium only, which passes.

## Progress log

- [x] 2D-canvas minis: gate `27a1040`, web-dist `4c5bf46`; site `6260068`
- [x] Reports carry the WebGL2 refusal reason: site `84171ec`
- [x] Linux GPU check script and README section
- [x] The script's summary with fixes, tried in WSL against faked machines
      (a bound AMD card with no Vulkan driver and a snap Firefox; a card with no
      driver and no firmware)
- [ ] The friend's script output or report
- [ ] Open question 1
- [ ] Open question 2

## Open questions for the user

1. Reword the no-WebGPU notice so it says node previews need WebGPU too, and
   that on Linux it may need turning on in the browser? Recommended.
2. Build meters and event strips that work without WebGPU (CPU-evaluated
   scalars and events)? Fields and textures would still need WebGPU.

## Things not to do

- Don't assume WebGPU works because "the output works": ask what the
  playground's notice says.
- Don't read anything into Firefox's renderer string.
- Don't touch Cloudflare settings (Insights beacon) without per-change
  authorization.
