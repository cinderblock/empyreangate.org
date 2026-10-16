# empyreangate.org

The website for [The Empyrean Gate](https://empyreangate.org), the Entheos
community's ring of light over a dance floor: sixty-four spokes of LEDs, a
gateway, and a fire beneath it. The gate's own software lives at
[TomSawyerLabs/empyrean-gate](https://github.com/TomSawyerLabs/empyrean-gate).

## Stack

Built from [cinderblock/ssg-base](https://github.com/cinderblock/ssg-base):
React 19 + React Router 8, Vite, TypeScript, Bun, Playwright, oxfmt + lefthook.
Fully prerendered. Two pieces of live code: the WebGL render of the array on the
home page, and the [pattern playground](#the-pattern-playground). The only
server code is the playground's Submit endpoint (`worker/index.ts`).

## Getting started

```sh
bun install
bun run dev
```

| Script              | Description                                                               |
| ------------------- | ------------------------------------------------------------------------- |
| `bun run dev`       | Dev server on :5173                                                       |
| `bun run build`     | Prerender to `build/client`, then emit 404.html + sitemap                 |
| `bun run preview`   | Serve the built site on :4180                                             |
| `bun run test`      | Playwright, against a fresh build (not the dev server)                    |
| `bun run test:unit` | Bun unit tests: render engine, build context                              |
| `bun run test:gpu`  | The playground tests that need WebGPU, in the installed Chrome (headless) |
| `bun run typecheck` | `react-router typegen && tsc`                                             |
| `bun run fmt`       | Format with oxfmt                                                         |
| `bun run photos`    | Web renditions of `photos/` + the photo manifest                          |
| `bun run og`        | Regenerate `public/og.png` from the built hero                            |

## Structure

```
app/
  root.tsx                HTML shell
  routes.ts               Route table: / and a real /404
  routes/home.tsx         The single page
  routes/playground.tsx   Shell for the playground (loads it after hydration)
  routes/404.tsx          Not found
  playground/             The pattern playground: page, IndexedDB store, Submit
  content/                Everything editable without touching layout:
    site.ts                 names, URLs, the next event, the array in numbers
    story.ts                prose, the timeline of appearances
    credits.ts              who made it
    gallery.ts              photo slots, each naming an original in photos/
    photo-manifest.ts       generated: sizes of the web renditions
  components/GateRender.tsx  The live render: WebGL2 canvas, scene chips, pause
  gate/
    geometry.ts             64 spokes x 378 px, inner/outer radius
    shaders.ts              GLSL port of a slice of the gate's WGSL layer shader
    presets.ts              Scenes: stacks of layers, starting with the house stack
    engine.ts               Phase integration, parameter wander, synthetic beat,
                            crossfades, ripples; the CPU half of the renderer
  styles/global.css       Everything visual
photos/                   High-resolution originals, committed (see its README)
scripts/photos.ts         Resizes photos/ into public/photos/ (gitignored) + manifest
scripts/postbuild.ts      404.html + sitemap.xml from the prerendered routes
scripts/og.ts             Screenshots the hero into public/og.png
worker/index.ts           The Worker: POST /api/submit only; assets serve the rest
tests/                    Playwright: content, render states, responsiveness, playground
plans/                    Working notes; start with empyreangate-site.md
wrangler.jsonc            Cloudflare Workers static-assets config
```

## The render

The gate's engine evaluates every light as a pure function of its polar
position and a per-layer phase, on the GPU, every frame. That makes a browser
port straightforward: `app/gate/shaders.ts` is a vertex shader that runs the
same maths once per drawn LED (one `gl.POINTS` draw, positions derived from
`gl_VertexID`), and `engine.ts` mirrors the CPU-side bookkeeping. Fifteen of
the engine's layer kinds are ported; audio-reactive terms are fed by a
synthetic beat clock. Pointer movement tilts the fields; a tap drops a ripple.

It pauses when off-screen, when the tab is hidden, and under
`prefers-reduced-motion` (with a Play button to override), and falls back to a
still SVG of the ring where WebGL2 isn't available.

## The pattern playground

`/playground` is the gate's own node editor and render engine in the browser,
from [`@empyrean-gate/patch-web`](https://github.com/TomSawyerLabs/empyrean-gate/tree/master/packages/patch-web)
(a git dependency on the gate repo's `web-dist` branch). The gate's Rust patch
compiler and evaluator run as wasm and the generated WGSL runs on WebGPU, so a
pattern looks here as it will on the gate. Patches are kept in IndexedDB; Save
to disk / Open file use the gate's own patch JSON, which its Patch tab imports.
Without WebGPU the editor still works and validates; only the preview is
missing.

**Submit** posts the patch, a name, an optional contact and note to
`/api/submit` (`worker/index.ts`), which checks Cloudflare Turnstile and the
patch's shape and stores one JSON object per submission in the R2 bucket
`empyreangate-submissions` (`submissions/<date>/<time>-<id>.json`). The Worker
needs the secret `TURNSTILE_SECRET` (and optionally `NOTIFY_WEBHOOK`, a
Discord/Slack-style webhook); the page needs the Turnstile site key in
`PLAYGROUND.turnstileSiteKey` (`app/content/site.ts`). Until both exist Submit
is hidden and the endpoint answers 503. Previews get the same bucket and rate
limit (the `previews` block in `wrangler.jsonc`) so Submit can be tried on
`dev.empyreangate.org` before launch; their secret is set separately, with
`wrangler preview secret put TURNSTILE_SECRET --name dev`.

**Notifications for the crew** are Web Push to an installed PWA, with no
third party in between: `/admin` (noindex) asks for the admin token, registers
`public/sw.js` and subscribes the device through `POST /api/notify/subscribe`;
subscriptions live in the same bucket under `notify/` (at most 50). Each
accepted submission is pushed to every device (`worker/webpush.ts`: RFC 8291
`aes128gcm` encryption and RFC 8292 VAPID, WebCrypto only), and "Send a test"
on the page (`POST /api/notify/test`) proves a device. The Worker needs three
more secrets, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `ADMIN_TOKEN` (`bun
run vapid` prints a fresh set); until then the page says notifications aren't
set up. `public/manifest.webmanifest` and the icons `bun run icons` renders
from the favicon make the site installable (on an iPhone, Add to Home Screen is
required before push is offered at all).

Growth is capped in the Worker, not in R2 (which has no quota): a visitor may
send five a minute (a `ratelimits` binding, per IP, nothing to provision), and
the bucket takes `LIMITS.perDay` (100) a day in all, checked with one list
call after the spam check so bots cannot spend it. With the 3 MB body limit
that is at most 300 MB a day, inside R2's free 10 GB-month even under a
month of abuse.

To review what came in, `bun run submissions` (`scripts/submissions.ts`) lists
the bucket through the Cloudflare API (`CLOUDFLARE_API_TOKEN` with Workers R2
Storage: Read, and `CLOUDFLARE_ACCOUNT_ID`), downloads new records into
`submissions/` (gitignored) and writes each patch on its own under
`submissions/patches/`, ready for the gate's Patch tab to open with Open file.

To try Submit locally, with Turnstile's always-pass test keys:

```sh
echo TURNSTILE_SECRET=1x0000000000000000000000000000000AA > .dev.vars
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA bun run build
bunx wrangler dev --local     # submissions land in .wrangler/state (local R2)
```

To develop against a local gate checkout instead of `web-dist`, run
`bun run build:wasm` in its `packages/patch-web`, then start the dev server
(or build) with `PATCH_WEB_DIR=<that path>`: Vite aliases the package's entry
points to that directory and serves its wasm from outside this repo. Nothing
in `package.json` or `bun.lock` changes.

On a phone the page stacks: the live gate docks at the top and shrinks into a
bar (with the tool, color, brightness and speed beside it) as you scroll, so
it stays in view over the controls and the node graph. "Keep the gate in view"
turns that off; both it and the one-time "works best on a desktop" toast are
remembered in localStorage. The editor itself switches to sheets (Add node,
and a node's settings on double-tap) when narrower than 640 px.

## Photos

Originals are committed in `photos/`; there won't be many. `bun run build`
runs `bun run photos` first, which writes WebP renditions at 800/1600/2400 px
and a JPEG fallback into `public/photos/` (gitignored, so Cloudflare rebuilds
them from the originals) and regenerates `app/content/photo-manifest.ts` with
their dimensions. EXIF, GPS included, is stripped. A slot in
`app/content/gallery.ts` points at an original by its slug.

## Deployment

**Cloudflare Workers Builds** builds this repo with `bun run build` and ships
it as Workers static assets, using `wrangler.jsonc`. GitHub Actions runs the
checks (format, typecheck, build, Playwright) on pushes and pull requests but
never deploys and holds no Cloudflare credential.

| Push to                | Workers Builds runs             | Result                                                                                        |
| ---------------------- | ------------------------------- | --------------------------------------------------------------------------------------------- |
| any branch but master  | `npx wrangler preview`          | A Preview at `https://<branch>.empyreangate.org` (noindex), e.g. https://dev.empyreangate.org |
| `master`, pre-launch   | `bunx wrangler versions upload` | A new version, **not** made live; empyreangate.org is unchanged                               |
| `master`, after launch | `bunx wrangler deploy`          | Live at https://empyreangate.org                                                              |

Preview builds mark themselves unindexable: `scripts/postbuild.ts` writes a
`_headers` file with `X-Robots-Tag: noindex` and a disallow-all `robots.txt`
whenever Workers Builds is building a branch other than master
(`scripts/build-context.ts`). Cloudflare adds that header to workers.dev
Previews itself, but not to custom-domain ones like `dev.empyreangate.org`.

Preview builds also point their social card (`og:url`, `og:image`,
`twitter:image`) at their own `<branch>.empyreangate.org`, so a preview link
pasted in a chat shows the image instead of fetching it from production. The
canonical link and the sitemap always name https://empyreangate.org.

Day to day, work on a branch (`dev`, or one per change) and open the Preview
URL Cloudflare reports on the build. Going live is a dashboard change: set the
deploy command to `bunx wrangler deploy` and push (or retry) a master build.

Workers Builds settings, for reference: production branch `master`; build
command `bun install --frozen-lockfile && bun run build`; preview command left
at its default; build variables `SKIP_DEPENDENCY_INSTALL=1` (so the image's own
install step can't pick a different package manager) and `BUN_VERSION`
matching the Bun that wrote `bun.lock` (the image's default Bun is older);
preview builds enabled.

The worker, the submissions bucket, the custom domain, and the redirects (`www.`, and both
`empyreangate.com` hostnames, all to `https://empyreangate.org/`) are managed
in [cinderblock/ops](https://github.com/cinderblock/ops).

## Contributing

Pull requests are welcome, especially photos and corrections to the timeline in
`app/content/story.ts`. CI runs the same checks as `bun run fmt:check`,
`bun run typecheck`, `bun run test:unit` and `bun run test`.
