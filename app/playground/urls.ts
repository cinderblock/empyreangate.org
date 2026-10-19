/**
 * The playground's URLs: every place in the editor has one, so a reload
 * reopens it and Back/Forward move between them.
 *
 *   /playground/                       whatever was open last
 *   /playground/p/<uuid>               a patch in this browser's library
 *   /playground/builtin/<name>         a built-in (`builtin-<name>`)
 *   …/<node>/<node>                    inside its Sub-patch nodes
 *
 * The deploy serves the playground's page for the last three
 * (`public/_redirects`), and `#patch=` share links still work on any of them.
 */

import {
  BUILTIN_PREFIX,
  type EditorLocation,
} from "@empyrean-gate/patch-web/editor";

export const PLAYGROUND_PATH = "/playground/";

export function playgroundPath(loc: EditorLocation): string {
  if (!loc.patch) return PLAYGROUND_PATH;
  const head = loc.patch.startsWith(BUILTIN_PREFIX)
    ? `builtin/${encodeURIComponent(loc.patch.slice(BUILTIN_PREFIX.length))}`
    : `p/${encodeURIComponent(loc.patch)}`;
  return [PLAYGROUND_PATH + head, ...loc.path.map(encodeURIComponent)].join(
    "/",
  );
}

/** The location a pathname names; null for the bare playground (or a path
 * that isn't one of these). */
export function parsePlaygroundPath(pathname: string): EditorLocation | null {
  const m = /^\/playground\/(p|builtin)\/([^/]+)((?:\/[^/]+)*)\/?$/.exec(
    pathname,
  );
  if (!m) return null;
  try {
    const id = decodeURIComponent(m[2]!);
    return {
      patch: m[1] === "builtin" ? BUILTIN_PREFIX + id : id,
      path: m[3]!.split("/").filter(Boolean).map(decodeURIComponent),
    };
  } catch {
    return null; // a malformed escape
  }
}
