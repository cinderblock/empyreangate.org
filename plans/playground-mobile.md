# Playground on phones, and the submission system

Status: **phone layout done and on the `dev` Preview (2026-10-16); Submit
waits on three Cloudflare steps that each need Cameron's yes.** Companion to `pattern-playground.md`,
which holds the architecture and the history; this doc is the mobile layout
round plus getting Submit live.

## Goal

The playground is usable on a phone: nothing covers the screen without a way
out, the live gate stays in view while you scroll through the controls and
the node graph, and a visitor is told up front that a desktop is the better
tool. And the submission system goes from "code done" to live, or as far as
it can go without Cloudflare changes Cameron has to approve one by one.

Cameron (2026-10-16): "do it all. boil the ocean. just don't publish the full
site yet." Push the site's `dev` only (never its `master`); the gate app's
`master` is fine.

## Environment / context

| What           | Where                                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Site checkout  | `C:\Users\camer\git\Personal Projects\empyreangate.org`, branch `dev` (shared with another agent; see `.agents.txt`, uncommitted)                  |
| Gate worktree  | `C:\Users\camer\.t3\worktrees\Empyrean\playground`, branch `patch-crate` (== gate `master`); push with `git push origin patch-crate:master`        |
| Editor package | gate `packages/patch-web/src/editor/{PatchEditor.tsx,editor.css}`; the site gets it via the CI-built `web-dist` branch pinned in `bun.lock`        |
| Dev Preview    | `https://dev.empyreangate.org/playground` (Workers Builds on every push to `dev`)                                                                  |
| Ops repo       | `C:\Users\camer\git\Personal Projects\ops` (another thread has large uncommitted edits there, including `empyreangate.yaml` and the worker schema) |

## Decisions already made (don't re-ask)

- **Breakpoint** stays the playground's 52rem (832px): below it the page
  stacks (gate, controls, editor).
- **Toast**: "works best on a desktop", narrow screens only, dismissable,
  remembered in localStorage, never on desktop.
- **Editor side panels on narrow screens become full-screen sheets** with a
  Done button; a node's settings open on double-tap (Cameron's suggestion)
  and from a floating pill shown while a node is selected. Single tap still
  only selects. Wide layouts are unchanged.
- **No toolbar at all in the compact editor** (Cameron, 2026-10-16: "at most
  one row of buttons, but even that feels heavy"): the patch name is a chip
  on the canvas that opens a menu sheet (rename, status, undo/redo, the
  host's open/save/submit, delete, the library, new blank/preset), ＋ opens
  the palette, ⚠ shows only while the patch cannot run.
- **Master brightness and speed live in the graph** (Cameron, 2026-10-16:
  "we need brightness and speed globals to show up more clearly in the
  react-flow area"): the editor takes a `globals` prop and pins a "Gate
  globals" card bottom-right inside React Flow (a `Panel`, so it keeps its
  corner while the graph pans): sliders with values on a wide canvas, a
  one-line chip with the values on a phone, toggled by its head. The site
  passes its brightness/speed state and drops the Master fieldset above the
  editor (the dock's side sliders on phones stay); the gate app's Patch tab
  passes the Live tab's master through `set_master`. Not a node type: a
  wirable Globals input node would be a crate/format change and a question
  for Cameron (see open questions).
- **The dock**: on narrow screens the live gate is sticky at the top; as you
  scroll it shrinks (a transform, so the canvas and its WebGPU context are
  never re-created) into a bar with controls on either side (tool + color on
  the left, brightness + speed on the right). A "Keep the gate in view"
  toggle turns it off; default on, remembered.
- **Tap mode lets the page scroll** from the canvas (`touch-action: pan-y`);
  draw mode and Touch-node patches keep `none`.
- **Submit stays hidden until the Turnstile site key exists** (as designed).
- **Terms** (Cameron, 2026-10-16): a submission grants us a licence (play,
  adapt, share, recordings) and the submitter is credited by the name they
  give when it is shown. Wording in `PLAYGROUND.terms`.
- **Previews get the real bucket and a secret** (Cameron, 2026-10-16: yes),
  so Submit is testable on `dev.empyreangate.org` before launch.
  No Cloudflare resource is created or changed without Cameron's explicit yes
  for that change (global rule).

## Plan / steps

1. [x] Read both repos; write this plan; `.agents.txt` introduction.
2. [x] Gate: compact mode in the shared editor (sheets, Add
       node button, double-tap settings, floating pill). Typecheck, layout
       gate, behaviour tests. Push to gate `master`; CI appends `web-dist`.
3. [x] Site: dock + scroll shrink, side controls, toggle; toast; pan-y in
       tap mode; compact header. Local dev against the gate worktree via
       `PATCH_WEB_DIR` (Vite alias, no lockfile change).
4. [x] Site: tests (`tests/playground-mobile.spec.ts`: playground at phone widths: no horizontal overflow, the
       dock shrinks and stays, the toast shows and stays dismissed).
5. [x] Site: `bun.lock` → web-dist `685745d` (`1965de5`).
6. [x] Submit: Worker tests green; `scripts/submissions.ts` (`3d944c8`) to pull submissions out of the bucket for
       review; README; the exact ops/Cloudflare steps staged for approval.
7. [x] Push `dev`; check the Preview on a phone-sized viewport. **Done; only the Cloudflare steps for Submit remain (need a yes each).**

## Findings / gotchas

- The other ops thread's uncommitted diff **removes `previews` from the
  worker schema and provider** (replaced by `generated_secrets`). If that
  lands as-is, `dev.empyreangate.org` preview routing is no longer declared
  in ops. Flagged to Cameron; not touched here.
- `wrangler` on this machine is logged out ("auth token has expired");
  nothing Cloudflare-side can be read from here without a login or
  `CLOUDFLARE_API_TOKEN`.

## Open questions for the user

1. ~~The three Cloudflare steps for Submit~~ Bucket and widget exist (ops CI,
   other agent); only the Worker secrets remain, behind Cameron's
   `bunx wrangler login` then `bun run secrets:setup`.
2. ~~Should the dev Preview get the bucket binding and secret too?~~ Yes
   (Cameron, 2026-10-16); bound in `wrangler.jsonc`, secret waits on the login.
3. Where submissions should notify (`NOTIFY_WEBHOOK`): still open.
4. Should the master also be a **wirable node** ("Globals" input with
   `brightness` and `speed` Scalar outputs), so a patch can react to the
   crew's settings? It is a crate change (registry, eval inputs gain master
   brightness, codegen, wasm, the gate engine feeding it) and a patch-format
   addition the gate carries forever; Agent B owns those files. The card
   shipped first because it is presentation only and does not foreclose it.
   Recommendation: only if a real patch wants it.

### The main ops checkout is stale, not edited (2026-10-16)

Cameron asked what the "previews removal" was. It is not a thread's work: the
main ops checkout's working tree is _older than its HEAD_ for 36 files.
`cloudflare/config/projects/empyreangate.yaml` on disk is byte-identical to
commit `90efcf5` (2026-10-11), the version before `102fbb9` added
`previews: true` (2026-10-12); `schema.json` and `providers/workers.ts` on
disk (mtime 2026-09-25) lack `previews_enabled` but carry a
`generated_secrets` field that is in no commit. So someone's edits were made
on a pre-`102fbb9` base and the files were never reconciled with the
fast-forwards since. Nothing was applied from that tree (the dry run here ran
from a clean worktree of `master`). If it were applied, ops would stop
_declaring_ preview routing; the provider only writes `previews_enabled` on an
update, so it would not switch it off, but it would be unmanaged. Needs a
look by whoever owns the `generated_secrets` work.

## Things not to do

- Don't push the site's `master`. Don't force-push `web-dist`.
- Don't resize the WebGPU canvas per scroll frame; scale it with a transform.
- Don't touch the other agent's hunks in this checkout; stage only mine.

## Submit: what is done and what needs a yes

Done and verified (2026-10-16):

- Worker, dialog and Turnstile flow unchanged since `7bdbe7a`; the Worker's
  unit tests pass (`bun run test:unit`).
- `bun run submissions` (`scripts/submissions.ts`): pulls every submission
  out of the bucket through the Cloudflare API (read-only), keeps the records
  in `submissions/` (gitignored) and writes each patch on its own in
  `submissions/patches/` so the gate's Patch tab can open it with Open file.
  Prints the queue. Needs `CLOUDFLARE_API_TOKEN` (Workers R2 Storage: Read)
  and `CLOUDFLARE_ACCOUNT_ID`. Untested against the real bucket (none yet);
  its pure parts have tests.

Three Cloudflare steps remain, each needing an explicit yes (global rule):

1. **Bucket, through ops.** Cameron said yes (2026-10-16, "we can add
   r2"). Declared and committed on ops branch `empyreangate-r2`
   (`d52e749`) in a worktree at `.t3/worktrees/ops/empyreangate-r2`, cut
   from ops `master` so the other thread's uncommitted ops edits stay out
   of it. The dry run there showed exactly one change (1 to create).
   **The apply failed: the ops sync token (`CF_API_TOKEN` in
   `cloudflare/.env.local`) has no R2 write permission**; the provider
   asks for "Workers R2 Storage: Edit". Once Cameron grants it (Cloudflare
   dashboard → profile → API tokens; a security setting, so his to change):
   `APPLY=1 bun sync` in that worktree's `cloudflare/`, push the branch to
   ops `master`, uncomment `r2_buckets` in the site's wrangler.jsonc. The
   entry as committed:

   ```yaml
   # Pattern-playground submissions: one JSON object per submission, written by
   # the site's Worker (worker/index.ts in the site repo, binding SUBMISSIONS).
   # wrangler deploy fails on a missing bucket rather than creating one, so this
   # must exist before the site's wrangler.jsonc carrying the binding deploys.
   # Growth is capped in the Worker (per-visitor rate limit, a daily cap).
   - r2: empyreangate-submissions
   ```

2. **Turnstile widget.** Dashboard: Turnstile → Add widget, name
   "empyreangate.org playground", hostnames `empyreangate.org` and
   `dev.empyreangate.org`, mode Managed. Or the API (token with Account →
   Turnstile → Edit):

   ```sh
   curl -X POST "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/challenges/widgets" \
     -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
     --data '{"name":"empyreangate.org playground","domains":["empyreangate.org","dev.empyreangate.org"],"mode":"managed"}'
   ```

   The answer carries `sitekey` (goes in `PLAYGROUND.turnstileSiteKey`,
   `app/content/site.ts`) and `secret` (next step).

3. **Worker secret.** `wrangler login` (the token on this machine has
   expired), then in the site checkout:

   ```sh
   bunx wrangler secret put TURNSTILE_SECRET --name empyreangate-org
   ```

   Optional: `NOTIFY_WEBHOOK` the same way, once a Discord/Slack channel is
   chosen.

After those: uncomment the `r2_buckets` binding in `wrangler.jsonc`, commit
the site key, push `dev`. Note that **Previews carry no bindings on purpose**
(`"previews": {}`), so on `dev.empyreangate.org` Submit keeps answering 503
and the end-to-end path is only exercised on production, which is not
published. If Cameron wants to see a real submission land before launch, the
preview environment can be given the same bucket binding and secret for a
while (`"previews": { "r2_buckets": [...] }` plus the secret on the preview
environment); test objects in a moderation queue do no harm.

### More findings (2026-10-16, later)

- **Verifying the dock needs WebGPU, which headless Chromium lacks.**
  Playwright's `chromium.launch({ channel: "chrome" })` (installed Chrome,
  headless) has it on this machine; the dock test skips itself otherwise.
- **Playwright empties `test-results/` when a run starts.** Keep scratch
  scripts and logs elsewhere.
- **Port 5174 was already FarmSlicer's dev server** (another project), so
  `localhost:5174` in Chrome showed that app. The playground dev server ran
  on 5180 with `PATCH_WEB_DIR` pointing at the gate worktree.
- **Chrome's zoom defeats `resize_window`** for phone layouts: the window
  will not go below ~516 px outer, and at the page's zoom that was 868 CSS
  px, above the 52rem breakpoint. Playwright viewports instead.
- **Gate CI caught a real timing bug**: on a fast runner, select → pill →
  sheet → Done fit inside the 400 ms double-tap window, so the next tap
  opened the sheet again. Fixed in `159dc55` (a sheet opening or closing
  resets the tap timer).
- **Absolutely positioned children don't take grid cells**: the canvas in
  the dock grid is `position: absolute`, so the right-hand controls landed
  in the middle column until given `grid-column: 3` explicitly.

## Progress log

- [x] 2026-10-16 survey, plan, `.agents.txt`
- [x] gate `64ccf3a` compact editor; `159dc55` tap-timer fix; CI web-dist `685745d`
- [x] site `137d32c` PATCH_WEB_DIR alias, `1965de5` web-dist bump, `3d944c8` submissions script
- [x] site `78c0c5e` preview trailing slash, `11eaab1` test:gpu, `e78c60f` phone layout; full suite 171 passed / 6 skipped (WebGPU) in chromium, firefox, webkit; `bun run test:gpu` 11/11
- [x] `dev` pushed (rebased onto the other agent's `5797460`; `85f2a63`); Preview checked at 393 px in headless Chrome with WebGPU: dock on → docked at 88 px, side controls live, editor compact, toast, no horizontal overflow
- [x] gate `d50de97` no toolbar in compact (web-dist `9c735c8`); site `41341e0`
- [x] gate `574b9de` "Gate globals" card (web-dist `962231d`; `tests/patch-globals.spec.ts`, mock `set_master`); site: Master fieldset gone, card wired, tests in both playground specs; playground specs 33 passed / 6 skipped (3 browsers), `test:gpu` 13/13

### Caps and cost (2026-10-16)

R2 has no quota or spend cap of its own, so the Worker caps growth
(`worker/index.ts`, smoke-tested in `wrangler dev --local`: five accepted,
the sixth 429):

| Cap                   | Value                           | Where                                               |
| --------------------- | ------------------------------- | --------------------------------------------------- |
| Body                  | 3 MB (4 Still images at 600 KB) | `LIMITS.bodyBytes`                                  |
| Per visitor           | 5 a minute per IP               | `ratelimits` binding `SUBMIT_LIMIT`, wrangler.jsonc |
| Per day, whole bucket | 100 (`LIMITS.perDay`)           | one `list` of today's prefix, after Turnstile       |
| Spam                  | Turnstile                       | unchanged                                           |

Worst case is 300 MB a day, 9 GB a month. R2 pricing (standard storage):
$0.015 per GB-month after a free 10 GB-month; Class A operations (writes,
lists) $4.50 per million after 1 million free; Class B (reads) $0.36 per
million after 10 million free; no egress charge. A realistic month (a few
hundred submissions, most without images) is a few MB and a few hundred
operations: $0. A month of sustained abuse at the caps is about 9 GB stored
and 6,000 Class A operations, both inside the free tier, and about $0.15 a
month for each further 9 GB kept after that. The review script's downloads
are Class B.
