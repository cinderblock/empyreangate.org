# Playground navigation: URLs, history, a patch browser, linked sub-patches

## Goal

Cameron (2026-10-18): "we need better navigation in the playground. The URL
opens a UUID for the current patch. maybe a simple database/directory tree of
known ones that are immutable. back/forward button should work to move between
patches. double click a sub-patch should open it."

So:

1. Every patch you look at has its own URL: a library patch by its UUID, a
   built-in by a readable name, and a sub-patch by the path of node ids down
   to it. Reloading the URL reopens it.
2. Browser Back/Forward move between the patches (and sub-patches) you opened.
3. A browser of what exists: the built-ins (immutable) and your patches, with
   a choice of views.
4. Double-clicking a Sub-patch node opens it.

## Decisions already made (don't re-ask)

From Cameron's answers on 2026-10-18:

- **Sub-patches start linked.** Inserting a saved patch or a built-in as a
  Sub-patch links it to that source. A linked Sub-patch has a "Clone for this
  project" button that makes an internal copy; once cloned, that button turns
  into "Update from <source>" whenever the source has changed since. My
  reading of "(which turns in to an update as appropriate)"; confirm with
  Cameron if the behaviour looks off.
- **Editing something that isn't yours to edit warns.** Opening a linked
  (non-internal) sub-patch and trying to edit it warns and offers the same
  clone. Built-ins are immutable the same way: they open read-only, and an
  edit attempt warns and offers a copy (fork) into your patches.
- **URLs are paths, not query strings.** Cameron leans to paths. Existing
  `#patch=` share links may be refactored if needed (they don't need to be:
  the fragment never reaches the server and still works on any playground
  path).
- **The browser offers several views**, switchable: a tree (folders, patches
  expanding to their sub-patches), topic folders, and a flat list.

## Design

### URLs (site)

- `/playground` — whatever was open last (as today).
- `/playground/p/<uuid>` — a patch in your library.
- `/playground/builtin/<slug>` — a built-in, `slug` = its id without the
  `builtin-` prefix (`/playground/builtin/rainbow-sparkle`).
- Either followed by `/<node id>/<node id>…` — inside that patch's sub-patch
  node(s), outermost first.
- `#patch=…` share links keep working on any of these.

Serving: the site is prerendered and the Worker only sees `/api/*`. The
playground route becomes a splat (`playground/*`, prerendering `/playground`)
and a static-assets rewrite serves `/playground/*` from the `/playground`
document (`_redirects`: `/playground/* /playground 200`), so the Worker still
isn't woken for pages. To verify on the Preview; fallback is adding
`/playground/*` to `run_worker_first` with the Worker returning the asset.

History: opening a patch, a built-in, or a sub-patch pushes an entry; Back and
Forward reopen the entry's target. Things that rename the current location
without moving (a new patch getting its UUID on first save, a fork replacing
the built-in it came from) replace the entry instead.

### The editor (gate repo, packages/patch-web)

Navigation lives in the shared editor so the gate app gets the browser and
sub-patch drilling too; the URL mapping is the host's.

- **Location**: `{ patch: string; path: string[] }` (`patch` = a library id or
  a built-in id). New props: `location`-change callback
  `onNavigate(loc, { replace })`; new handle method `navigate(loc)` for the
  host to call on Back/Forward and on load.
- **Open document vs. shown document**: the editor keeps the root document it
  saves, and shows the document at `path` inside it. Edits on a shown inner
  document are written back into the root's Sub-patch node. The preview keeps
  rendering the root.
- **Read-only frames**: a built-in, or a linked sub-patch, shows read-only. An
  edit attempt (drag, connect, knob, palette) shows a bar: built-in → "Make a
  copy"; linked sub-patch → "Clone for this project" (and, for a library
  source, "Open <source>" to edit it everywhere).
- **Double-click / double-tap a Sub-patch** opens it. A breadcrumb on the
  canvas (Root › Sub › Sub) goes back up. On a phone the node's settings sheet
  stays reachable from a ⚙ in the opened sub-patch's breadcrumb (its knobs
  belong to the parent's node).
- **Browser panel** (replaces the "Open patch…" and "New from preset…"
  selects): views Tree / Topics / Flat. Topics are derived from what a patch
  uses (Audio, DJ, Touch, Phone motion, Video, Code, Sub-patches…), so they
  need no new field and apply to your patches too.

### Linked sub-patches (crate + stores)

A Sub-patch node keeps its `sub` snapshot (so compiling, files and
submissions stay self-contained, and the compiler needs no library access)
and gains:

- `source`: the id of the patch it came from (library UUID or built-in id);
- `linked`: true while the snapshot follows the source;
- `source_rev`: a content hash of the source as last copied, so a clone can
  tell when "Update from <source>" applies.

Keeping linked snapshots current: one crate function (`sync_links`), used by
the gate's file store on save and by the playground's IndexedDB store (via
wasm) on put, refreshes every linked snapshot of the saved patch in every
other patch. The editor also refreshes on open, which covers built-ins
changing with an app update.

Existing documents: Sub-patch nodes without `source` are internal copies, as
they are today. No format bump (all fields optional).

## Plan / steps

1. [ ] Crate: `NodeInst.source / linked / source_rev`, `sync_links`, content
       hash, tests; wasm exports. **← current**
2. [ ] Gate store: propagate on save; test.
3. [ ] Editor: location model, shown-vs-root document, write-back, breadcrumb,
       double-click to open, read-only frames + warning bar.
4. [ ] Editor: linked insert, Clone / Update buttons in the Sub-patch panel,
       refresh on open, cycle guard in the palette.
5. [ ] Editor: browser panel with Tree / Topics / Flat.
6. [ ] Gate checks (cargo test, tsc, unit, behaviour specs) + new specs;
       merge to gate master; web-dist bot bumps the site.
7. [ ] Site: splat route, `_redirects`, URL ↔ location, history, store
       `sync_links` on put, playground specs, README.
8. [ ] Verify on the dev Preview (deep link, reload, Back/Forward, double-click).

## Findings / gotchas

- Serde ignores unknown fields here (no `deny_unknown_fields`), so the gate
  would silently drop `source`/`linked` on save unless `NodeInst` declares them.
- `wrangler.jsonc` assets use `not_found_handling: "404-page"` and
  `run_worker_first: ["/api/*"]`: a bare `/playground/x` is a 404 today.
- The editor's double-click today only opens the settings sheet, and only in
  the compact layout (`onNodeOpen` returns early on a wide canvas).
- `insertSubpatch` blanks the inner id, so today's sub-patches don't know
  where they came from.

## Progress log

- 2026-10-18: explored; questions answered by Cameron; plan written. Gate
  worktree `C:\Users\camer\.t3\worktrees\Empyrean\patch-navigation` (branch
  `patch-navigation`, from gate master e620bbc).

## Open questions for the user

1. (Not blocking) Should the gate app's Patch tab also put the location in
   its URL? The browser and sub-patch drilling arrive there for free; URLs
   there are a separate small step. Recommendation: later, if wanted.

## Things not to do

- Don't bump the site's `bun.lock` by hand: the web-dist bot does it.
- Don't push the site's master; dev only (Preview).
- Shared site checkout: stage only this plan's files, `git commit --only`.
