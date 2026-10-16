/**
 * PWA icons from the favicon, for the web app manifest (installing the site
 * on a phone is how the crew gets push notifications; see /admin). Written to
 * `public/icons/` (gitignored, rebuilt on every build like the photos).
 *
 *   bun run icons
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const SRC = "public/favicon.svg";
const OUT = "public/icons";
const BACKGROUND = "#06060f";

await mkdir(OUT, { recursive: true });

/** The favicon on the site's background, `size` square; `inset` is the
 * fraction of the side left clear on each edge (maskable icons need a safe
 * zone of 10%, with the mark inside the central 80%). */
async function icon(name: string, size: number, inset: number) {
  const mark = Math.round(size * (1 - 2 * inset));
  const glyph = await sharp(SRC)
    .resize(mark, mark, { fit: "contain", background: BACKGROUND })
    .png()
    .toBuffer();
  const png = await sharp({
    create: { width: size, height: size, channels: 4, background: BACKGROUND },
  })
    .composite([
      {
        input: glyph,
        left: Math.round(size * inset),
        top: Math.round(size * inset),
      },
    ])
    .png()
    .toBuffer();
  await writeFile(join(OUT, name), png);
  console.log(`${join(OUT, name)} (${size}px)`);
}

await icon("icon-192.png", 192, 0.1);
await icon("icon-512.png", 512, 0.1);
await icon("icon-512-maskable.png", 512, 0.2);
await icon("badge-96.png", 96, 0.1);
