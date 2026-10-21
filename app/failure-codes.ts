/**
 * The ways the site can fail in a visitor's browser that we want to hear
 * about. Shared by the pages (app/failures.ts, the watchdog in root.tsx) and
 * the Worker, which counts only these (`POST /api/failure`) and files
 * reports only about these (`POST /api/report`).
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
} as const;

export type FailureCode = keyof typeof FAILURE_CODES;

export function isFailureCode(code: unknown): code is FailureCode {
  return typeof code === "string" && Object.hasOwn(FAILURE_CODES, code);
}

/** A build id as the pages send it: a commit (Workers Builds) or `local`. */
export function isBuildId(build: unknown): build is string {
  return typeof build === "string" && /^(?:[0-9a-f]{7,40}|local)$/.test(build);
}
