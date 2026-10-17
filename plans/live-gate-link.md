# Linking the public site to the live gate

Status: **in progress (2026-10-17)**. Cameron: "Sounds great. Get implementing."

## Goal

Three links between `empyreangate.org` and the gate app running at a show:

1. **Play it live.** A public URL (`play.empyreangate.org`) reaches the gate
   app's public floor (its second listener, `127.0.0.1:9521`, built to sit
   behind a cloudflared tunnel; `docs/public-deploy.md` in the gate repo).
2. **The site knows when the gate is up.** A Worker route on the site asks
   the floor's health endpoint and caches the answer; the home page and the
   playground show a "Play it live" button only while the gate answers, plus
   "On the gate now: _patch_ by _credit_".
3. **Submissions reach the gate without a laptop.** A Worker route lists the
   R2 queue behind the existing admin token; the gate's Patch tab gets a
   Submissions drawer that imports one in a click and marks it used or
   declined. The token lives in the gate's config on the show machine (which
   already holds the show's own tokens) and in GitHub Actions secrets.

## Environment / context

- Site repo: `C:\Users\camer\git\Personal Projects\empyreangate.org`, branch
  `dev` (Preview at https://dev.empyreangate.org). Never push `master`.
  Shared checkout: `.agents.txt` (uncommitted) lists the agents; stage own
  hunks only, `git commit --only <paths>`.
- Gate worktree: `C:\Users\camer\.t3\worktrees\Empyrean\playground`, branch
  `patch-crate`, push with `git push origin patch-crate:master`. CI appends
  `web-dist`; the site pins it in `bun.lock` (`bun update @empyrean-gate/patch-web`).
- Ops repo: `~/git/Personal Projects/ops` (main checkout is behind and has
  someone's uncommitted edits; use a worktree under `.t3/worktrees/ops/`).
  Workstation tokens are read-only; CI applies on `master`. Precedent for a
  Windows box with cloudflared as a service: `plans/noook-t3-tunnel.md`.
- Show machine: `empyreangate` (Windows 11, headscale 100.64.0.2, `ssh
empyreangate`). Not ops-managed; the cloudflared install is a manual step
  Cameron runs, like noook.
- Gate protocol facts used here: the operator port treats loopback as the
  operator (`addr.ip().is_loopback()`); a remote `SetConfig` keeps the
  server's own tokens (`server.rs` SetConfig handler preserves
  `admin_token` etc.); `redact_for_remote` blanks secrets in `State`
  snapshots. The public listener's `/health` was a bare 204.
- Site Worker: `worker/index.ts`; `ADMIN_TOKEN` already guards
  `/api/notify/*` (Bearer). R2 records: `submissions/<day>/<visitor>/<ms>-<uuid>.json`
  with `{id, submittedAt, name, contact, message, country, patch}`.

## Decisions already made (don't re-ask)

- Hostname `play.empyreangate.org` (my proposal; Cameron answered "sounds
  great" to the whole design). The ops change is staged on a branch and
  **not applied** until Cameron says yes to that exact diff (global rule).
- The gate fetches the queue through its own backend (`/patch/submissions*`
  on the operator port, loopback only), not from the browser: the token
  never leaves the backend and no CORS is needed on the site.
- Credit travels with the patch: `PatchDoc.credit` (crate, serde default,
  skipped when empty; TS `credit?: string`). Import sets it from the
  submitter's name; the public health reply carries it for "now playing".
- `/api/live` memoises the floor's answer for 10 s per isolate and answers
  `{live:false}` when `LIVE_URL` is unset or the floor is unreachable. The
  gate therefore sees a handful of pollers at most, never every visitor.
- Decisions on a submission move the object to `reviewed/<decision>/<leaf>`
  (used / declined) with `decision` and `decidedAt` added; nothing is deleted.
- No thumbnail in the drawer for now (it would need a compile of each
  submission in the gate UI); name, credit, when, message and node count.

## Plan / steps

1. [ ] Gate crate: `PatchDoc.credit`.
2. [ ] Gate backend: `SubmissionsConfig {site_url, token}` in `AppConfig`
       (token redacted for remotes, preserved on remote SetConfig; fixtures
       regenerated); routes `GET /patch/submissions`, `GET /patch/submissions/record?key=`,
       `POST /patch/submissions/decide` (loopback only; proxy to the site with
       the token); public `/health` returns JSON `{ok, open, players, game, now_playing}`.
3. [ ] Gate UI: Settings → Submissions panel (site URL, token); Patch tab
       "Submissions…" drawer (`src/PatchSubmissions.tsx`); mock backend serves a
       fake queue; a Playwright spec; README + `docs/public-deploy.md`.
4. [ ] Site Worker: `GET /api/live` (`LIVE_URL` var), `GET /api/submissions`,
       `GET /api/submissions?key=`, `POST /api/submissions/decide`; unit tests.
5. [ ] Site pages: `app/live.ts` hook; hero "Play it live" + now-playing line;
       playground bar chip; Playwright specs with `page.route("**/api/live")`;
       README.
6. [ ] Ops: worktree `empyreangate-play` from `origin/master`: tunnel
       `empyreangate` + `play.empyreangate.org` ingress → `http://127.0.0.1:9521`;
       validate + dry run; commit on the branch; `plans/empyreangate-play-tunnel.md`
       with the box-side steps. **Not pushed, not applied: needs Cameron's yes.**
7. [ ] Push gate master, wait for web-dist, bump the site, push dev, check
       the Preview.

## Findings / gotchas

- (none yet)

## Open questions for the user

1. The hostname: `play.empyreangate.org` unless you prefer another.
2. The ops diff, once staged: yes to push + apply?
3. The cloudflared service install on the show machine is yours to run (the
   tunnel token comes from the Zero Trust dashboard, like noook).

## Things not to do

- Don't point any proxy at the operator port (9520); only at 9521.
- Don't push the site's `master`; don't push or apply the ops change without
  a yes to that diff.
- Don't put the admin token anywhere on this workstation.

## Progress log

- [ ] gate commit(s)
- [ ] site commit(s)
- [ ] ops branch commit
