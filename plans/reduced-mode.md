# Reduced mode: saying what a browser is missing

## Goal

Cameron asked (2026-10-23): a banner like "running in reduced mode" when
browser features are missing, that opens a dialog explaining what's missing,
runs a small self-test, and offers to upload the results. Before this, the
only sign was the paragraph in the playground's preview area ("This browser
does not support WebGPU…") and the editor's "no WebGPU" status pill; nothing
said the node previews (minis) were gone too.

Follows `plans/minis-without-webgpu.md` (a friend's Firefox on Ubuntu: no
WebGPU, WebGL2 blocklisted). It also answers that plan's open question 1
(say that node previews need WebGPU, and that on Linux it may need turning
on).

## Environment / context

- Site worktree `~/.t3/worktrees/empyreangate.org/minis-2d`, branch
  `minis-2d`, pushed as `dev` (site master stays dark).
- Reports: `app/failures.ts` (`gatherReport`, `REPORT_FIELDS`),
  `app/components/ReportProblem.tsx` (the dialog), `worker/index.ts`
  (`POST /api/report`, fields clipped to `REPORT_LIMITS.field` = 500),
  `scripts/reports.ts` (`bun run reports`). Codes in `app/failure-codes.ts`:
  `FAILURE_CODES` are counted, `REPORT_CODES` adds the ones that aren't.
- WebGPU types: `@webgpu/types` comes with the gate's package
  (`/// <reference types="@webgpu/types" />`).
- The Linux script's URL can pin the build's commit: raw.githubusercontent
  accepts the 12-character SHA that `__BUILD_ID__` carries (checked: 200).

## Decisions already made (don't re-ask)

- Banner in the playground only, when the live preview is missing
  (`gpuError`: no WebGPU, or it didn't start). A missing WebGL2 alone isn't
  reduced mode there: the minis draw on a 2D canvas and look the same. The
  self-test still reports it.
- The self-test runs in the page when the dialog opens; nothing is sent
  until the visitor presses Send in the usual report dialog (every field
  shown first, Turnstile).
- Its upload is a report with a new, uncounted code `browser-check` and a
  new field `selftest` (own limit, 2000 characters: several lines with
  renderer strings outgrow 500).

## Plan / steps

1. `app/browser-check.ts`: the tests (WebGPU compute + canvas, WebGL2 and
   WebGL1 draw + read back, 2D canvas read back, WebAssembly), each with a
   timeout; and the results as text.
2. `components/BrowserCheck.tsx`: the button and dialog; Send hands over to
   `ReportDialog`.
3. Reports carry `selftest`: failures.ts, worker, reports.ts, tests.
4. Playground banner; CSS.
5. Privacy page, README, Playwright test.
6. Typecheck, unit tests, Playwright (Chromium), commit, push dev.

## Findings / gotchas

- A stub that fails the first `getContext("webgpu")` doesn't put the
  playground in reduced mode (the runtime attaches its canvas later, outside
  `PatchRuntime.create`); failing the first `requestAdapter` does, and leaves
  the self-test's own adapter request real. That is how the WebGPU path was
  tried on a real GPU: "Computed and drew a frame on intel, gen-9", and
  WebGL2 "Drew and read back on ANGLE (Intel … D3D11)".
- raw.githubusercontent.com takes the 12-character SHA in `__BUILD_ID__`
  (checked against `bcd5bf04ccf2`: 200), so the Linux script's command is
  pinned to the build; a local build points at `dev`.
- The preview paragraph used to send visitors to "current Chrome, Edge or
  Safari"; it now points at What's missing?, which has per-browser advice.

## Progress log

- [x] Steps 1–6. Chromium: the full suite (111 passed, 12 skipped); the GPU
      suite (18 passed); a throwaway spec for screenshots of a
      Firefox-on-Linux stand-in (no WebGPU, WebGL2 refused), desktop and
      phone.
- [ ] Seen on the friend's machine (that's where it matters).

## Open questions for the user

- (none)

## Things not to do

- Don't recommend closed software in the dialog's Linux advice (the friend
  is an open-source enthusiast); the script it points to already follows
  that rule.
