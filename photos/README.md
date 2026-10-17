# Photos

Drop the high-resolution originals here (JPEG, PNG, WebP or TIFF; not HEIC),
committed as they are. `bun run photos` turns each into web renditions under
`public/photos/` and updates `app/content/photo-manifest.ts`; `bun run build`
does the same, so Cloudflare rebuilds them from the originals too.

A file's slug is its name lower-cased with runs of anything that isn't a letter
or digit turned into `-`: `Gate Night Wide.JPG` becomes `gate-night-wide`. Put
that slug in the slot's `asset` in `app/content/gallery.ts`, and the
photographer in its `by` (a `Person` from `app/content/credits.ts`) so the
caption credits them.

EXIF (including GPS) is stripped from everything served.
