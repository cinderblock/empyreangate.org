/**
 * Post-build fixups that the prerenderer doesn't do itself.
 *
 * 1. Copy the prerendered not-found page to `404.html`, which is the filename
 *    Cloudflare's `not_found_handling: "404-page"` looks for. Without it a
 *    miss gets the empty SPA shell — no heading, nothing without JavaScript.
 * 2. Emit `sitemap.xml` from the prerendered routes, so it can never drift
 *    out of sync with what actually shipped.
 * 3. On a preview build (any branch but master, on Workers Builds), mark every
 *    response `X-Robots-Tag: noindex` via `_headers` and replace robots.txt
 *    with a full disallow. See build-context.ts.
 */

import { copyFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PREVIEW_HEADERS, PREVIEW_ROBOTS, buildKind } from "./build-context";

const OUT = "build/client";
const SITE = "https://empyreangate.org";

/** Routes deliberately kept out of the sitemap. */
const EXCLUDE = new Set(["/404", "/admin"]);

await copyFile(join(OUT, "404/index.html"), join(OUT, "404.html"));
console.log(`Emitted ${join(OUT, "404.html")}`);

/** Every prerendered `index.html` is one real URL. */
async function routes(dir: string, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // Hashed build output, not routes.
      if (entry.name === "assets") continue;
      found.push(
        ...(await routes(join(dir, entry.name), `${prefix}/${entry.name}`)),
      );
    } else if (entry.name === "index.html") {
      found.push(prefix === "" ? "/" : prefix);
    }
  }
  return found;
}

const urls = (await routes(OUT))
  .filter((r) => !EXCLUDE.has(r))
  .sort((a, b) => a.localeCompare(b));

const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...urls.map((u) => `  <url><loc>${SITE}${u === "/" ? "/" : u}</loc></url>`),
  "</urlset>",
  "",
].join("\n");

await writeFile(join(OUT, "sitemap.xml"), sitemap, "utf8");
console.log(`Emitted ${join(OUT, "sitemap.xml")} with ${urls.length} URL(s)`);

if (buildKind(process.env) === "preview") {
  await writeFile(join(OUT, "_headers"), PREVIEW_HEADERS, "utf8");
  await writeFile(join(OUT, "robots.txt"), PREVIEW_ROBOTS, "utf8");
  console.log(
    `Preview build of ${process.env.WORKERS_CI_BRANCH}: noindex _headers and a disallow-all robots.txt`,
  );
}
