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
  into "Update from <source>" whenever the source has changed since. This
  reading of "(which turns in to an update as appropriate)" was confirmed by
  Cameron on 2026-10-19.
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
- **The gate app's Patch tab keeps no URL for now** (2026-10-19). It gets the
  browser and sub-patch drilling from the shared editor; putting the location
  in its URL is a separate step for later, if Cameron asks.

## Design (as built)

### URLs (site)

- `/playground/` — whatever was open last (the deploy serves the playground
  at the directory form; a bare `/playground` redirects there).
- `/playground/p/<uuid>` — a patch in this browser's library.
- `/playground/builtin/<slug>` — a built-in, `slug` = its id without the
  `builtin-` prefix (`/playground/builtin/rainbow-sparkle`).
- Either followed by `/<node id>/<node id>…` — inside that patch's Sub-patch
  node(s), outermost first.
- `#patch=…` share links keep working on any of these.

Code: `app/playground/urls.ts` (+ test). Serving: the route is the splat
`playground/*` (prerendering `/playground`), and `public/_redirects` rewrites
`/playground/p/*` and `/playground/builtin/*` to `/playground/` with status 200. Only those two prefixes: Cloudflare applies `_redirects` rules "regardless
of whether or not an asset matches", and real files live under
`/playground/` (`agents.md`, `registry.json`, …). `vite preview` gets the same
rewrites from a small middleware in `vite.config.ts` that reads the built
`_redirects`, so the Playwright suite exercises the real file.

History: the editor reports each move through `onNavigate(loc, {replace})`;
`Playground.tsx` turns it into React Router `navigate(path, {replace})`, and
an effect on the router location calls `editorRef.navigate(loc)` when Back /
Forward (or a typed URL) moved it. Opening a patch, a built-in or a Sub-patch
pushes; a new patch's first save and a built-in's copy replace. A deep link to
a library id this browser doesn't have, or an unknown built-in, shows a notice
and falls back to the last patch.

### The editor (gate repo, packages/patch-web)

- `editor/navigation.ts`: `EditorLocation {patch, path}`, `docAt`,
  `validPath`, `lockAt` (built-in or inside a linked Sub-patch), `cloneAlong`,
  `flatId` (minis inside a Sub-patch key on the flattened `"{sub}/{inner}"`
  ids), `crumbs`.
- `PatchEditor.tsx` keeps `root` (what saves and renders) and `path`, and shows
  `docAt(root, path)`. Every mutation funnels through `mutateDoc`, which
  refuses on a locked frame (bar: "Make a copy to edit" / "Clone for this
  project" / "Edit <source> everywhere"). Undo history holds roots.
- Double-click (or double-tap) a Sub-patch opens it; breadcrumb at the top of
  the canvas (under the chips on a phone). On a phone the Sub-patch's own
  settings stay one tap away via the "Sub-patch settings…" pill.
- `editor/PatchBrowser.tsx`: 📁 Patches, views Tree / Topics / List (stored
  in localStorage). Topics come from node kinds (a table in the file). On a
  wide layout it replaces the palette while open and closes on a pick; on a
  phone it is in the ☰ menu sheet.
- Sub-patch panel: Open inside, Clone for this project, Open <source>, and on
  a clone "Update from <source>" when `sourceRev(source) != source_rev`
  (asks twice if the clone was changed too).

### Linked sub-patches (crate + stores)

`NodeInst.source / linked / source_rev` (crate `lib.rs`); the copy stays in
`sub`, so compile/files/submissions are unchanged and no format bump was
needed. `crate::links::{snapshot, links_to, sync_links}`; the gate's
`patch::store::propagate_links` runs on `PatchSave` (bumping the engine when
the active patch was refreshed); the TS mirror `editor/links.ts` serves the
mock backend and the playground's `LocalPatchStore.put`. The editor also
refreshes stale linked copies on open (built-ins change with the app).
Library summaries gained `kinds` and the `subpatches` tree.

## Plan / steps

1. [x] Crate: link fields, `links` module, tests.
2. [x] Gate store: propagate on save; summaries; test.
3. [x] Editor: location model, shown-vs-root, write-back, breadcrumb,
       double-click, read-only frames + bar.
4. [x] Editor: linked insert, Clone / Update, refresh on open, cycle guard.
5. [x] Editor: browser panel with Tree / Topics / List.
6. [x] Gate checks + spec `patch-navigation`; on gate master as be3004b
       (rebased over Agent L's palette overhaul and the Code-aids work).
7. [x] Site: splat route, `_redirects`, URLs, history, store, spec, README —
       on dev as f1e9c5b-era commits, pushed at e098ebc (2026-10-19).
8. [x] Verified on the dev Preview in Cameron's Chrome (2026-10-19 07:20Z):
       `/playground/builtin/scope` deep link opens read-only, `agents.md`
       still served as markdown, Back/Forward between built-ins, a real
       double-click opens a Sub-patch (`…/n3`, breadcrumb, live minis
       inside), Back comes out. A scratch patch made for this was deleted.
9. [x] Follow-up nit found there: after deleting the open patch the editor
       reopened the page's first deep link. Gate e1e0bc2 (the host's
       starting location counts once); on dev with the bot's bump d8eabf7
       (web-dist fc19800).

## Findings / gotchas

- Serde ignores unknown fields here (no `deny_unknown_fields`), so the gate
  would have silently dropped `source`/`linked` on save without the fields.
- `parsePatchFile` rebuilt nodes field by field and dropped `text`,
  `collapsed` and `layers` (Open file…, `#patch=` links, the agent's
  setPatch). Fixed separately: gate d66a69b.
- The autosave timer was shared across patches: edit, open another patch and
  edit within 600 ms, and the first patch's last edit was lost. Navigation
  made this easy to hit (found by the spec). Fixed separately: gate be3004b
  (flush on open and on unmount).
- Playwright's `page.reload()` in Firefox adds a history entry of its own
  (history.length 2 → 3 with no pushState from the page), so a test that
  reloads and then goes Back fails there only. The site spec reloads last.
- Matching Playwright filters against paths: a filter word equal to the
  worktree's directory name (`patch-navigation`) matched every spec locally.
  Run lists as `tests/<name>.spec` in this worktree.
- A Bash heredoc through this tool turned `\\n` / `\\r` into real line breaks
  inside Python string literals; write such edit scripts with the file tool
  or build backslashes with `chr(92)`.
- Workers static assets honour `_redirects` 200 rewrites on the Preview
  (verified), and `/playground/` stays the canonical bare URL.
- The new palette (Agent L) is wider: a test double-clicking a node near the
  canvas edge hit the side panel its first click opened. Tests double-click
  a node's corner.
- The WebGPU suite (`bun run test:gpu`) used the removed New-from-preset
  select; fixed on dev (Touch Ripples from the browser).
- Unrelated flakes seen under full parallel load, passing alone: site
  `home.spec.ts:74` (webkit), gate `multitouch.spec.ts:73` (webkit),
  `patch-compact.spec.ts:31`.

## Progress log

- 2026-10-18: explored; questions answered by Cameron; plan written.
- 2026-10-19: gate work done and on master (d66a69b file fields, 9355344
  link model + store, 6a8ef68 editor, be3004b save flush). Gate checks green
  locally: typecheck, 142 unit, 137 crate + 341 app Rust tests, behaviour
  suite (170, one webkit flake that passes alone). Site work done and green
  locally on all three browsers (navigation spec 6/6).
- 2026-10-19: site on dev (e098ebc), Preview verified; gate e1e0bc2 nit.
  Unrelated failures logged in ISSUES.md (home/render on Firefox+WebKit).
- 2026-10-19: e1e0bc2 reached dev with the bot's bump (d8eabf7). Cameron
  confirmed the Clone / Update reading and agreed gate-app URLs wait. Done.

## Open questions for the user

None.

## Things not to do

- Don't bump the site's `bun.lock` by hand: the web-dist bot does it.
- Don't push the site's master; dev only (Preview).
- Shared site checkout: stage only this plan's files, `git commit --only`.
- Don't widen `_redirects` to `/playground/*`: it would shadow the agent docs
  and JSON files served from that directory.
