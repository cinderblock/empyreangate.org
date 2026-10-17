# Launch readiness

## Goal

Open empyreangate.org to the public (planned 2026-10-18): check security,
Cloudflare usage and billing, and performance before master publishes, and
verify production right after. The launch itself is step 8b of
`plans/empyreangate-site.md` (fast-forward `master` to `dev`; Workers Builds
runs `npx wrangler deploy`, so the push publishes).

## Decisions already made (don't re-ask)

- The post-deploy manifest 404 (ISSUES.md) is not a launch concern
  (Cameron, 2026-10-17).
- Post-launch checks are scripted: `bun run launch-check` (production) or
  `bun run launch-check <origin>`; read-only.

## Findings

- **Workers Paid** ($5/month; Cameron, 2026-10-17): 30 s CPU, so the Submit
  CPU worry is moot; overages are billed rather than refused. The ops cost
  monitor alerts at $0.50/hour or $5/day of Cloudflare usage. Worst
  realistic case is a junk flood at `/api/submit` (each rejected cheaply but
  still a billed invocation, ~$0.30/M beyond 10M a month): 1,000 req/s for a
  day is about $25. The Worker's own rate limits don't stop billing, since
  the Worker must run to refuse; only an edge rule does.

- **Billing exposure is pennies.** Static assets are free and never wake the
  Worker (`run_worker_first: ["/api/*"]`). R2 growth is capped at 100
  submissions a day of at most 3 MB. Turnstile, Web Analytics and the
  rate-limit binding are free. On Workers Free the risk is limits (100k
  `/api` requests a day; 10 ms CPU), not bills.
- **Submit CPU, measured in V8 (Node 24, this desktop) on the same JSON work
  as `submit()`:** typical patch (4 stills ~40 KB, 30 nodes, 0.17 MB) ~1–2 ms;
  the heaviest the gate allows (4 stills at the 600 KB `MAX_MEDIA_BYTES`, 256
  nodes, 2.4 MB) 13–18 ms; a hand-built 3 MB body 14–28 ms. Stills are
  256×256 WebP, so real patches are far below the cap. Only a pathological
  patch could exceed Free's 10 ms.
- **A failed Submit loses nothing.** The patch lives in IndexedDB; the dialog
  stays open with "The server said 503." (an 1102 is an HTML 503) and the
  visitor can retry or Save to disk.
- **Production today** (`bun run launch-check`, 2026-10-17): www and both
  .com hosts 301 to the apex; the workers.dev hostname is 404; everything
  else is ops' 503 stub, as expected before launch. The dev Preview passes
  all eight checks.
- **Security, found in review (all five now fixed):** (1) the 100/day cap is a
  shared pool one person can fill in ~20 minutes; (2) catch blocks log
  nothing; (3) `patch.name` is unbounded and can push a Web Push payload past
  ~4 KB; (4) production sends no security headers (`_headers` is preview
  only); (5) latent: a Discord `NOTIFY_WEBHOOK` would honour `@everyone`.
- **Gallery:** two of six slots filled (TedX's UnSCruz 2024 night shots,
  `20b4584`). Production shows only those two; Previews still show the four
  "Photo coming: …" placeholders.
- **Submission keys changed** with the per-visitor cap:
  `submissions/<day>/<visitor>/<ms>-<id>.json`. Objects written before
  (`submissions/<day>/<ms>-<id>.json`, the test submissions) still count
  toward their day and `bun run submissions` reads both.

## Progress

- [x] Pre-launch review (Worker, wrangler config, ops config, plans)
- [x] `bun run launch-check` (`fe85011`)
- [x] Gallery: two night shots in `night-wide` and `build` (`20b4584`)
- [x] Submit CPU estimate (above)
- [x] Security fixes, with Cameron's go-ahead ("do your proposed fixes"):
      per-visitor daily cap (10; IPv4 or IPv6 /64, keyed hash in the object
      key), console.error in every catch, patch names clipped in
      notifications, Discord `allowed_mentions` (`d5f74b5`); safety headers on
      every build, checked by launch-check (`0e2a3e8`)
- [x] Billing alert: already covered. The site is on account `c5987fbf…`,
      which the ops `uptime` Worker's cost monitor polls hourly (Workers
      requests, R2 ops and storage; dollar thresholds; R2 storage budget
      10 GB). No change needed.
- [x] Empty gallery slots hidden on production, kept on Previews (`eef3835`)
- [x] dev Preview: launch-check 9/9 green with the new headers; Preview
      still shows the 4 placeholders, the production build none
- [ ] Edge rate-limit rule on `/api/*` (30 per 10 s per IP, block 10 s).
      Cameron: "Rate limit seems reasonable", then "you can commit to Ops".
      Committed as ops `732a112` on branch `empyreangate-api-rate-limit`
      (worktree `~/.t3/worktrees/ops/empyreangate-api-rate-limit`, off
      `origin/master` `e5515bd`). Validate passes and the dry-run sync shows
      1 to create, 0 to update, 0 to delete. **Not pushed**: pushing to ops
      master is what applies it, and that needs its own yes.
- [x] Cool night shot captioned "unSCruz 2024." in its own slot
      (`unscruz-2024`). "Raising it." is an empty slot again, for a real
      build shot (Cameron: "It's raised and setup. Caption should be
      unSCruz.")
- [x] Photo credit: Cameron said "Yes, credit TedX". TedX is taken to be
      Theodore Wahrburg, already in the crew list. A slot's `by` puts
      "Photo: <name>" under the caption, linked to his site (`d89c8b9`).
- [ ] After master publishes: `bun run launch-check`, all green

## Findings: the edge rule

- The Free plan allows one rate-limit rule per zone, with only Path (and
  Verified Bot) in the expression, IP counting, a 10 s period and a 10 s
  timeout. Cloudflare's docs don't say which operators the Free plan takes.
  `matches` (regex) is Business and up. The rule uses `wildcard`, and only
  the real apply can prove Free accepts it. The API (read-only token) shows
  the zone is on "Free Website" with no `http_ratelimit` entrypoint yet
  (404), so the one Free slot is open. If it's refused, use
  `starts_with(http.request.uri.path, "/api/")`.
- TedX's photos carry no EXIF, XMP or IPTC, only an ICC profile (1440×1440,
  an Instagram-style export). The only date is in the file names,
  `IMG_20240428_230641_*`: 2024-04-28 23:06:41.
- The ops pre-commit hook's `cloudflare-validate` needs `DO_SERVERS` from
  `cloudflare/.env.local`, which Bun loads from the working directory. A
  fresh worktree has no such file, so the hook fails on `firefly.isozilla.com`.
  Sourcing the file in the shell breaks its JSON. To commit, copy the file
  in, then delete it.
- The shared ops checkout is dirty and 9 commits behind, and its copy of
  `empyreangate.yaml` has someone else's uncommitted edit (it drops
  `previews: true`). Leave it alone; work in the dedicated worktree.

## Open questions for Cameron

1. Push ops `732a112` to ops master (CI applies it), then watch the run?
   Recommended. If Free refuses `wildcard`, switch to `starts_with`.
2. Ask Ted for the originals? They'd be sharper than the ~230 KB,
   1440×1440 copies we have now. Optional.
