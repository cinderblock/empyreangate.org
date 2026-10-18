# Linking the public site to the live gate

Status: **code shipped and the Cloudflare side applied (2026-10-18 00:33 UTC);
waits on the show machine** (steps 8–9). Cameron: "Sounds great. Get implementing."

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

1. [x] Gate crate: `PatchDoc.credit` (gate `629d15c`).
2. [x] Gate backend (gate `629d15c`): `SubmissionsConfig {site_url, token}` in `AppConfig`
       (token redacted for remotes, preserved on remote SetConfig; fixtures
       regenerated); routes `GET /patch/submissions`, `GET /patch/submissions/record?key=`,
       `POST /patch/submissions/decide` (loopback only; proxy to the site with
       the token); public `/health` returns JSON `{ok, open, players, game, now_playing}`.
3. [x] Gate UI (gate `629d15c`; `tests/patch-submissions.spec.ts`): Settings → Submissions panel (site URL, token); Patch tab
       "Submissions…" drawer (`src/PatchSubmissions.tsx`); mock backend serves a
       fake queue; a Playwright spec; README + `docs/public-deploy.md`.
4. [x] Site Worker (site `7a3c37a`): `GET /api/live` (`LIVE_URL` var), `GET /api/submissions`,
       `GET /api/submissions?key=`, `POST /api/submissions/decide`; unit tests.
5. [x] Site pages (site `7a3c37a`): `app/live.ts` hook; hero "Play it live" + now-playing line;
       playground bar chip; Playwright specs with `page.route("**/api/live")`;
       README.
6. [x] Ops: Cameron said yes (2026-10-17, "Yes on ops deploy"); pushed as ops
       master `b67a088`; the Cloudflare run (39083155429) created tunnel
       `empyreangate` (id `c954b757-45c1-4669-a1dd-946865a80d0e`), the ingress
       `play.empyreangate.org → http://127.0.0.1:9521` and the proxied CNAME;
       sync-verify clean; the name resolves. Until a connector runs on the show
       machine the name answers Cloudflare's error page and `/api/live` stays
       `{"live":false}`.
       \1
7. [ ] Show machine (off right now; `ssh empyreangate` times out): install
       cloudflared and its service with the tunnel's token. Cameron has no access
       yet; walk him through it when it is back, or do it over SSH with his yes.
8. [ ] Gate app on the show machine: Settings → Public floor (listener on,
       `127.0.0.1:9521`, URL `https://play.empyreangate.org`, floor open) and
       Settings → Submissions (the site's admin token). Then the end-to-end check.

## Findings / gotchas

- The gate's Playwright specs run against `dist/` served by the mock backend:
  `bun run build` first, or a new button is simply not there.
- `git commit -m ... --only -- <paths>`: `-m` must come before the `--`, or
  git reads the message as a pathspec.
- An ops worktree needs `bun install --frozen-lockfile` at its root (lefthook
  lives in root `node_modules`), a copy of `cloudflare/.env.local` (the
  read-only workstation tokens) for `bun run sync` to dry-run, and
  `bunx prettier --write` on new files before the hook lets a commit through.
- `reqwest` 0.13 as built here has no `.json()` on `RequestBuilder` (no
  `json` feature): send `serde_json::Value::to_string()` with a content-type.
- The gate's `now_playing` reads the patch file by id; `store::load` scans
  the whole library, so `/health` memoises it for 5 s.

## Open questions for the user

1. ~~The hostname~~ `play.empyreangate.org`, applied.
2. ~~The ops diff~~ yes, applied.
3. The show machine: when it is back, do you want me to install cloudflared
   over SSH (your yes for that one command), or type it yourself? Either way
   the tunnel token is read on the machine (`cloudflared tunnel login` then
   `cloudflared tunnel token empyreangate`) or copied from the dashboard.

## Things not to do

- Don't point any proxy at the operator port (9520); only at 9521.
- Don't push the site's `master`; don't push or apply the ops change without
  a yes to that diff.
- Don't put the admin token anywhere on this workstation.

## Progress log

- [x] gate `629d15c` on gate master: crate credit; SubmissionsConfig +
      routes + health JSON; Settings panel; Patch tab drawer + spec; mock queue;
      README + docs. Crate 89/89, backend 340/340, patch-web 13, gate unit 14,
      specs patch-submissions/minis/image/compact/public-floor/settings green.
- [x] site `7a3c37a` on `origin/dev`: `/api/live`, `/api/submissions*`,
      LiveLink hero button + now-playing + playground chip, specs, README,
      web-dist bump. Unit 47/47, typecheck clean, home + playground specs 33
      passed / 4 skipped (no WebGPU). Preview: `/api/live` → `{"live":false}`.
- [x] ops branch `empyreangate-play` (worktree `.t3/worktrees/ops/empyreangate-play`):
      one commit, validate green, dry run 2 to create. **Awaiting Cameron's yes
      to push/apply.** Box-side steps in `plans/empyreangate-play-tunnel.md` there.
- [x] ops master `b67a088` applied by CI: tunnel, ingress, CNAME created.
- [ ] Show machine: cloudflared service; gate Settings (Public floor,
      Submissions); end-to-end check (steps 8–9).
