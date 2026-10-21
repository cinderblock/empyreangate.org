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
11. **(current)** Fast-forward `dev`, push, check the Preview in Chrome.

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
- [ ] Step 11: land on `dev`, check the Preview (Workers Builds creates the
      dataset on first write; confirm with `bun run reports`)

## Open questions for the user

1. Should a report notify the crew (Web Push, like a submission, and/or
   `NOTIFY_WEBHOOK`)? Not done: today reports wait for `bun run reports`.
   Recommendation: yes, the webhook only, if one is set.

## Things not to do

- Don't add identifiers, the user agent or country to `/api/failure`: the
  no-consent footing depends on it. The privacy page promises it.
- Don't touch Cloudflare outside `wrangler.jsonc` in this repo.
- Don't make the stuck page recover here (reload once): that is the
  separate ISSUES.md entry about the manifest 404.
