/**
 * Which kind of build this is, from the environment Workers Builds injects.
 *
 * Workers Builds sets `WORKERS_CI=1` and `WORKERS_CI_BRANCH` on every build.
 * Pushes to `master` are production builds; every other branch becomes a
 * Worker Preview at `<branch>.empyreangate.org`. Previews must never be
 * indexed: Cloudflare adds `X-Robots-Tag: noindex` on workers.dev Previews
 * but not on custom-domain ones like these.
 *
 * Anywhere else (local builds, GitHub Actions) the build is treated as
 * production, which is what gets tested.
 */

export const PRODUCTION_BRANCH = "master";
export const PRODUCTION_ORIGIN = "https://empyreangate.org";
const PREVIEW_PARENT = "empyreangate.org";

export type BuildKind = "production" | "preview";

export function buildKind(env: Record<string, string | undefined>): BuildKind {
  if (env.WORKERS_CI !== "1") return "production";
  const branch = env.WORKERS_CI_BRANCH;
  if (!branch) {
    throw new Error(
      "WORKERS_CI is set but WORKERS_CI_BRANCH is empty; can't tell a preview from production",
    );
  }
  return branch === PRODUCTION_BRANCH ? "production" : "preview";
}

/**
 * Which build this is, as failure counts and reports name it: the commit
 * Workers Builds is building (`WORKERS_CI_COMMIT_SHA`), shortened, or
 * `local` for any build it didn't make.
 */
export function buildId(env: Record<string, string | undefined>): string {
  const sha = env.WORKERS_CI_COMMIT_SHA?.toLowerCase();
  return sha && /^[0-9a-f]{7,40}$/.test(sha) ? sha.slice(0, 12) : "local";
}

/**
 * `_headers` for a build. Every build gets the same few safety headers: no
 * MIME sniffing, no full URLs in the Referer sent to other sites, and no
 * framing by other sites (`frame-ancestors`, with X-Frame-Options for old
 * browsers). Not a full CSP: the wasm, Turnstile and the analytics beacon
 * Cloudflare injects make one easy to get wrong. No Permissions-Policy
 * either: the playground uses the motion sensors. A preview also says
 * noindex on every response. One `/*` block, since Cloudflare applies every
 * rule that matches and the order of merged headers isn't worth relying on.
 */
export function headersFile(kind: BuildKind): string {
  return [
    "/*",
    "  X-Content-Type-Options: nosniff",
    "  Referrer-Policy: strict-origin-when-cross-origin",
    "  Content-Security-Policy: frame-ancestors 'none'",
    "  X-Frame-Options: DENY",
    ...(kind === "preview" ? ["  X-Robots-Tag: noindex"] : []),
    "",
  ].join("\n");
}

/** robots.txt for a preview: crawl nothing. */
export const PREVIEW_ROBOTS = `User-agent: *
Disallow: /
`;

/**
 * The hostname label a branch's Preview gets. Wrangler sends the raw branch
 * name and Cloudflare derives the label server-side, undocumented; this
 * mirrors Wrangler's own branch sanitiser (`sanitizeBranchName`), which is
 * exact for plain names like `dev`. Keep preview branch names plain.
 */
export function previewLabel(branch: string): string {
  const label = branch
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  if (!label)
    throw new Error(`branch "${branch}" has no usable hostname label`);
  if (label.length > 63) {
    throw new Error(
      `branch "${branch}" makes a ${label.length}-character hostname label; DNS allows 63. Use a shorter branch name.`,
    );
  }
  return label;
}

/**
 * Where this build will be served, for links that must load from the page's
 * own host: the social card image above all. A Preview linked in a chat
 * would otherwise point its card at production, which may not be live (it
 * answered 503 when this was written) or may show a different build.
 * Canonical links and the sitemap stay on PRODUCTION_ORIGIN regardless.
 */
export function siteOrigin(env: Record<string, string | undefined>): string {
  if (buildKind(env) === "production") return PRODUCTION_ORIGIN;
  return `https://${previewLabel(env.WORKERS_CI_BRANCH!)}.${PREVIEW_PARENT}`;
}
