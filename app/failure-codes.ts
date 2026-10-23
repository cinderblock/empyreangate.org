/**
 * The ways the site can fail in a visitor's browser that we want to hear
 * about. Shared by the pages (app/failures.ts, the watchdog in root.tsx) and
 * the Worker, which counts only these (`POST /api/failure`) and files
 * reports only about these and `REPORT_CODES` (`POST /api/report`).
 *
 * Each code is what a count carries, so it must say nothing about the
 * visitor: only which part of the site broke.
 */
export const FAILURE_CODES = {
  "asset-load": "A script the page needs didn't load.",
  "page-stuck": "The page didn't finish loading.",
  "render-webgl":
    "This browser can't run the home page's live render (no WebGL2).",
  "render-shader": "The home page's live render didn't compile on this GPU.",
  "playground-load": "The playground's code didn't load.",
  "engine-load": "The playground couldn't load the gate's patch engine.",
  "webgpu-unavailable":
    "The playground's live preview needs WebGPU, and this browser has none.",
  "webgpu-start": "The playground's live preview didn't start.",
  uncaught: "Something in the site's code failed unexpectedly.",
} as const;

export type FailureCode = keyof typeof FAILURE_CODES;

export function isFailureCode(code: unknown): code is FailureCode {
  return typeof code === "string" && Object.hasOwn(FAILURE_CODES, code);
}

/**
 * What a report can be about: any failure, `user-report`, something a
 * visitor noticed themselves (the playground's "Report a problem"), or
 * `browser-check`, the results of the playground's test of what the
 * browser lacks ("What's missing?"). Those two are never counted: nothing
 * failed on its own.
 */
export const REPORT_CODES = {
  ...FAILURE_CODES,
  "user-report": "A visitor noticed something wrong.",
  "browser-check": "A visitor sent the results of the browser check.",
} as const;

export type ReportCode = keyof typeof REPORT_CODES;

export function isReportCode(code: unknown): code is ReportCode {
  return typeof code === "string" && Object.hasOwn(REPORT_CODES, code);
}

/** A count's `where`: one of the site's own scripts, by name. */
export function isWhere(where: unknown): where is string {
  return typeof where === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(where);
}

/**
 * Which of the site's own scripts `url` is, by name without its hash: a
 * built chunk `<origin>/assets/<name>-<8-char hash>.js` gives `<name>`
 * (`Playground`, `react-dom`). Anything else (another origin, an
 * extension, an inline script) is null: not ours to count.
 */
export function ownScript(url: string, origin: string): string | null {
  if (!url.startsWith(`${origin}/assets/`)) return null;
  const m = /^([\w.-]+?)-[\w-]{8}\.js$/.exec(
    url.slice(origin.length + "/assets/".length).replace(/[?#].*$/, ""),
  );
  return m && isWhere(m[1]) ? m[1] : null;
}

/** The first script URL in a stack trace (V8's `at f (url:1:2)` or
 * Firefox/Safari's `f@url:1:2`): where the error was thrown. Any scheme,
 * so an extension's frame on top is found as what it is. */
export function firstStackUrl(stack: string): string | null {
  return /([a-z][a-z0-9+.-]*:\/\/[^\s()@]+?):\d+:\d+/i.exec(stack)?.[1] ?? null;
}

/** A build id as the pages send it: a commit (Workers Builds) or `local`. */
export function isBuildId(build: unknown): build is string {
  return typeof build === "string" && /^(?:[0-9a-f]{7,40}|local)$/.test(build);
}
