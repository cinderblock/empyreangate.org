# Failure reports and failure counts

## Goal

Find out when the site breaks in visitors' browsers, which we can't see
today. Cloudflare Web Analytics already counts page views and Web Vitals; the
Worker's own errors already reach Workers Logs. What's missing is the
client side: the playground without WebGPU, a shader that won't compile on
some GPU, a page that never hydrates (ISSUES.md: the manifest 404 after a
deploy).

Two pieces, both approved by Cameron on 2026-10-21 ("Do it" / "sure"):

1. **Ask when something breaks.** Where the site shows a failure, a "Send a
   report" button opens a dialog that shows exactly what would be sent (the
   error, the browser, the GPU), takes an optional note and contact, passes
   Turnstile, and posts to `/api/report`. Stored in the submissions bucket
   under `reports/`.
2. **Count failures anonymously.** On those same failures, and on a page
   that never hydrates, a beacon to `/api/failure` carries only a failure
   code and the build. No IDs, cookies, user agent or country. Counted in
   Workers Analytics Engine.

Plus a `/privacy` page that says what the site collects, since (2) relies
on being disclosed.

## Environment / context

- Worktree: `C:\Users\camer\.t3\worktrees\empyreangate.org\failure-reports`,
  branch `failure-reports` from `origin/dev`. Lands by fast-forwarding `dev`
  and pushing `dev` (Preview at dev.empyreangate.org, behind Cloudflare
  Access). Never the site's `master`.
- Worker: `worker/index.ts`, tests `worker/index.test.ts` (`bun run test:unit`).
- Cloudflare account has Analytics Engine on: the read-only token in ops
  `cloudflare/.env.local` (`CF_API_TOKEN`) answered `SHOW TABLES` with 200
  (no datasets yet). Datasets are created on first write; the binding lives
  in `wrangler.jsonc` (top level _and_ `previews`, which don't inherit).
- Workers Builds sets `WORKERS_CI_COMMIT_SHA`; the build id comes from it.

## Decisions already made (don't re-ask)

- Both pieces, as described above (Cameron, 2026-10-21).
- No general opt-in telemetry and no third-party service (Sentry, PostHog).
- Failure pings carry the code, the build and the site's own hostname
  (production vs Preview), nothing about the visitor.
- Reports reuse the existing bucket, Turnstile widget and the `SUBMIT_LIMIT`
  rate-limit binding (keys prefixed `report:` / `failure:`), so the only new
  Cloudflare resource is the Analytics Engine dataset.
- A page that never hydrates only gets a count, not a report button: React
  isn't running there to show one, and making that page recover (reload
  once) is the separate ISSUES.md entry, not this task.

## Plan / steps

1. `app/failure-codes.ts` (shared with the Worker) and `app/failures.ts`:
   `countFailure` (beacon, once per code per page), `gatherReport`,
   `sendReport`. Build id via a Vite `define` (`__BUILD_ID__`,
   `buildId()` in scripts/build-context.ts).
2. `app/turnstile.ts`: the Turnstile loader out of SubmitDialog, as a hook.
   Dialog styles moved from playground.css to global.css as `.dialog*`.
3. `app/components/ReportProblem.tsx`: the button, and a dialog portalled to
   the body (so the button can sit inside a `<p>`).
4. Failures wired: GateRender fallback (`render-webgl`, `render-shader`),
   the playground's WebGPU (`webgpu-unavailable`, `webgpu-start`) and engine
   (`engine-load`) failures, an ErrorBoundary on the playground route
   (`playground-load`).
5. `app/watchdog.ts`, inlined by root.tsx: `asset-load` and `page-stuck`
   (not hydrated 20 s after `load`; App sets `<html data-hydrated>`).
6. Worker: `POST /api/failure`, `POST /api/report`; tests.
7. `wrangler.jsonc`: `FAILURE_COUNTS` → dataset `empyreangate_failures`, top
   level and `previews`.
8. `/privacy` page, home footer link, linked from the report dialog.
9. `scripts/reports.ts` (`bun run reports`).
10. Playwright `tests/failures.spec.ts`; README; typecheck, fmt, tests.
11. Fast-forward `dev`, push, check the Preview in Chrome. Done.

## Findings / gotchas

- The Analytics Engine SQL API answered 429 (code 971) to the very first
  request, then 200 a minute later. Retry before concluding anything.
- The playground's URL carries a local patch's id (`/playground/p/<uuid>`).
  Reports mask it (`/playground/p/…`); it means nothing outside that browser.
- Playwright can't route a `sendBeacon` in every browser; the spec wraps
  `navigator.sendBeacon` in an init script and records the bodies instead.
- An inline module script whose import 404s fires `error` on its own
  `<script>` (no `src`), which is how the watchdog sees the manifest 404.
  Proven by the watchdog test in all three browsers.
- The Bash tool mangles heredocs that contain backticks; edit such files
  with the Edit tool or a script file instead.
- My Write/Edit and Python edits wrote CRLF; the repo is LF
  (`.gitattributes`). `bun run fmt` puts it right before committing.

## Progress log

- [x] Plan
- [x] Steps 1–10 (Worker in c0d76ce on branch `failure-reports`; the rest
      committed after it)
- [x] Step 11: on `dev` (4f6a0fc, then the empty retry 423ffe9). On the
      Preview (2026-10-21): /privacy renders; `POST /api/failure` 204 for a
      known code, 400 for an unknown one; `POST /api/report` 403 with a
      fake Turnstile token (so the route and secret are there); the
      watchdog is in the head and the page sets `data-hydrated`. One test
      count (`page-stuck`, build `local`, dev.empyreangate.org) showed up
      in `bun run reports` about a minute later.
- [ ] A real report through the dialog with a real Turnstile pass: needs a
      person (agents don't complete CAPTCHAs). Covered by Playwright with a
      stand-in Turnstile.

## Findings from landing

- The first Workers Build of 4f6a0fc (60cd86e8) built, then every asset
  upload batch got `401 Unauthorized` from `/workers/assets/upload`
  (`wrangler preview`), before bindings came into it. An empty commit
  (423ffe9) rebuilt the same tree and deployed. Read the log with the ops
  env's `CF_BUILDS_TOKEN`:
  `GET /accounts/<id>/builds/builds/<build uuid>/logs`.
- The full Playwright suite: 306 passed, 3 failed. The same 3 fail on
  untouched dev `ee557a2`, so they were already failing; logged in
  ISSUES.md (4f6a0fc).
- The Analytics Engine SQL API took about a minute to show the first write.

## Open questions for the user

1. ~~Should a report notify the crew?~~ Cameron, 2026-10-21: yes, webhook
   only (f364491), then: "i don't have a webhook ready. i assumed we'd store
   in some cloudflare database for later processing." That storage is what
   already happens (reports in R2 under `reports/`, counts in Analytics
   Engine, read with `bun run reports`). The webhook line stays dormant
   until a `NOTIFY_WEBHOOK` exists; no local collection endpoint is needed.
2. ~~Move to `telemetry-collector`?~~ Cameron, 2026-10-21: no. (Researched
   at its `371a262`: its error path always stores the user agent and
   country, there's no Turnstile or alerting, and it may not be deployed.)
3. ~~Count unexpected JS errors?~~ Cameron, 2026-10-21: yes. See
   "Unexpected errors" below.

## Unexpected errors (2026-10-21, done)

Goal: count JavaScript errors nobody planned for, without giving up the
privacy promise.

- New code `uncaught`. A count may also carry `where`: the name of the
  site's own script the error came from, without its hash (e.g.
  `Playground`). That says which part of the site broke, nothing about the
  visitor. The error message stays out of counts (it can quote what a
  visitor typed); reports still carry it, by choice.
- Only errors thrown by the site's own `/assets/` scripts count: the
  throwing script's URL (`ErrorEvent.filename`, else the first URL in the
  stack) must be ours. Extensions, Turnstile, the analytics beacon and
  "Script error." from other origins are ignored.
- `window` `error` and `unhandledrejection`, watched from App's mount
  (`watchUncaught` in failures.ts). Once per (code, where) per page.
- A root `ErrorBoundary` (root.tsx) for a page that crashes while
  rendering: counts `uncaught`, shows Reload and "Send a report". The
  playground keeps its own boundary.
- Worker: optional `where` (validated, else dropped) → blob4.
  `bun run reports` groups by it.
- /privacy, README and tests follow.
- Done: unit tests (`app/failure-codes.test.ts`, Worker, reports) and
  Playwright (`tests/failures.spec.ts`: an error and a rejection planted in
  the privacy chunk are counted as `where: privacy`; errors from
  `page.evaluate` are not; a render crash shows the root boundary). Full
  suite 2026-10-21: 321 passed, 0 failed.
- On the Preview (e2b73be): /privacy has the new wording; an error thrown
  from the console (not the site's code) sent no beacon; a test count
  `uncaught`/`privacy`/`local` showed in `bun run reports` with its script.
  The two `local` rows in the dataset are these checks.

## Report a problem from the playground (2026-10-21, done)

Cameron couldn't find a way to report from a working playground: "Send a
report" only appears on failure screens. Asked, Cameron chose a "Report a
problem" link in the playground's top bar, always there.

- New report code `user-report`, accepted by `/api/report` only. It is not
  a failure code: nothing failed on its own, so it is never counted in
  Analytics Engine (`/api/failure` still takes only `FAILURE_CODES`).
- Same dialog and the same preview of every field. With no error to show,
  the note is the point: labelled "What went wrong?" and required (the
  Worker refuses a `user-report` without one).
- /privacy, README and tests follow.
- [x] Code, tests, /privacy, README (Playwright 324 passed, 0 failed; port 4180 was another worktree's preview, so a temporary config on 4182: Firefox and WebKit refuse 4190 as a restricted port)
- [x] On `dev` (851fcc6) and checked on the Preview: the link sits between "Using an AI agent?" and the source links; the dialog is titled "Report a problem", has no error row, masks the patch id (`/playground/p/…`), and keeps Send disabled until there is a note. Not sent (a real report needs a person at Turnstile).

## A report can carry the pattern (2026-10-21, done)

Asked whether a report should be able to include the pattern if the
visitor opts in; Cameron: "absolutely".

- Every report sent from inside the playground (the top bar's "Report a
  problem" and the playground's own failure screens) offers "Include my
  pattern", unticked. The dialog says what that adds: the pattern's name,
  how many nodes, its size, and how many images it holds (Still nodes keep
  theirs inside the patch).
- Sent as `patch` (the `PatchDoc`, as Submit sends it). The Worker checks it
  like a submission (`parsePatchFile`, node and edge limits), then stores
  it as a patch file (`exportPatch`, so the playground's Open file loads it)
  at `report-patterns/<date>/<visitor>/<ms>-<id>.json`. The report record
  points at it (`patch: <key>`).
- Its own prefix, so it neither counts against the 5 reports a visitor may
  send a day nor shows up as a report in `bun run reports`. Its own daily
  cap (`patternsPerDay`): a pattern can be 3 MB (images), and reports allow
  200 a day, so without one a day of abuse could be 600 MB on top of
  submissions' 300 MB.
- The report body limit grows to fit a submission-sized pattern.
- `bun run reports` downloads each pattern to `reports/patterns/`.
- /privacy (patterns now also leave the browser with a report, by
  choice), README and tests follow.
- [x] Code, tests, /privacy, README. Unit 82 passed. Playwright: the
      failures spec 39 passed; the full suite 325 passed and 2 failed in WebKit
      (`home.spec.ts:74`, `playground.spec.ts:470`, neither about reports) on a
      run that took 8.9 min against the usual 4.6 under load; both passed 6 of 6
      rerun alone.
- [x] On `dev` (37e685a) and checked on the Preview: the dialog's "Include my
      pattern" box starts unticked and reads, for the open patch, “<name>”: 9
      nodes, 1 KB. Not sent (a real report needs a person at Turnstile).

## Things not to do

- Don't add identifiers, the user agent or country to `/api/failure`: the
  no-consent footing depends on it. The privacy page promises it.
- Don't touch Cloudflare outside `wrangler.jsonc` in this repo.
- Don't make the stuck page recover here (reload once): that is the
  separate ISSUES.md entry about the manifest 404.
