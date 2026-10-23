/**
 * Hearing about failures in visitors' browsers, two ways:
 *
 * - `countFailure`: an anonymous count, sent without asking. It carries the
 *   failure's code and the build, and for an unexpected error which of the
 *   site's own scripts threw it; nothing about the visitor (no IDs,
 *   cookies, user agent, error text). The Worker adds it to Workers
 *   Analytics Engine (`POST /api/failure`). The page that never hydrates is
 *   counted by the watchdog in root.tsx instead, since this module never
 *   runs there. `watchUncaught` counts the errors nobody planned for.
 * - `gatherReport` + `sendReport`: a report the visitor chooses to send from
 *   the failure's own screen (components/ReportProblem.tsx), after seeing
 *   every field of it (`POST /api/report`). The playground also offers one
 *   at any time ("Report a problem", code `user-report`), for what only a
 *   person notices; that one is never counted. A report from the
 *   playground can carry the visitor's pattern, if they tick the box.
 *
 * The privacy page (routes/privacy.tsx) describes both; keep it in step.
 */

import type { PatchDoc } from "@empyrean-gate/patch-web/types";
import {
  FAILURE_CODES,
  firstStackUrl,
  isFailureCode,
  ownScript,
  type FailureCode,
  type ReportCode,
} from "./failure-codes";

export { FAILURE_CODES, type FailureCode, type ReportCode };

const counted = new Set<string>();

/** Count one failure, once per page load (per script, for `where`). Never
 * throws, never waits. */
export function countFailure(code: FailureCode, where?: string): void {
  const key = where ? `${code}:${where}` : code;
  if (import.meta.env.DEV || counted.has(key)) return;
  counted.add(key);
  const body = JSON.stringify(
    where
      ? { code, build: __BUILD_ID__, where }
      : { code, build: __BUILD_ID__ },
  );
  try {
    if (navigator.sendBeacon?.("/api/failure", body)) return;
  } catch {
    // Some browsers refuse beacons outright; fall back to a fetch.
  }
  void fetch("/api/failure", { method: "POST", body, keepalive: true }).catch(
    () => {},
  );
}

/** Which of the site's own scripts threw `error`, or null if none did: its
 * stack's top frame decides, so an extension or a third-party script
 * calling into ours isn't counted as ours. */
export function errorScript(error: unknown, filename?: string): string | null {
  const url =
    filename ||
    (error instanceof Error && error.stack ? firstStackUrl(error.stack) : null);
  return url ? ownScript(url, location.origin) : null;
}

/**
 * Count errors nobody planned for: anything thrown by the site's own
 * scripts that reaches `window` (`error`, `unhandledrejection`). Errors from
 * elsewhere (extensions, Turnstile, the analytics beacon, the browser's own
 * "ResizeObserver loop" notices) aren't ours and aren't counted. Returns the
 * cleanup.
 */
export function watchUncaught(): () => void {
  const onError = (e: ErrorEvent) => {
    const where = errorScript(e.error, e.filename);
    if (where) countFailure("uncaught", where);
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    const where = errorScript(e.reason);
    if (where) countFailure("uncaught", where);
  };
  addEventListener("error", onError);
  addEventListener("unhandledrejection", onRejection);
  return () => {
    removeEventListener("error", onError);
    removeEventListener("unhandledrejection", onRejection);
  };
}

/** What a report carries, every field shown to the visitor before sending. */
export interface Report {
  code: ReportCode;
  /** The error itself, as the page saw it; empty on a `user-report`. */
  message: string;
  /** The page's path, without the query or fragment (a fragment can hold a
   * whole patch), and without the id of a patch of the visitor's own. */
  page: string;
  build: string;
  /** The browser's user-agent string. */
  browser: string;
  /** What WebGPU offers: the adapter's vendor, architecture and device. */
  webgpu: string;
  /** What WebGL reports as its renderer, and the browser's reason when it
   * refuses WebGL2. */
  webgl: string;
  /** Window size and pixel ratio. */
  screen: string;
  /** The browser check's results (components/BrowserCheck.tsx), one line
   * per test; empty on any other report. */
  selftest: string;
}

/** The fields of a report, labelled, in the order the dialog shows them. */
export const REPORT_FIELDS: { key: keyof Report; label: string }[] = [
  { key: "message", label: "What went wrong" },
  { key: "page", label: "Page" },
  { key: "build", label: "Site version" },
  { key: "browser", label: "Browser" },
  { key: "webgpu", label: "WebGPU" },
  { key: "webgl", label: "WebGL" },
  { key: "screen", label: "Screen" },
  { key: "selftest", label: "Self-test" },
];

/** The subset of WebGPU this file uses; the DOM lib has no WebGPU types. */
interface GpuLike {
  requestAdapter(): Promise<{
    info?: {
      vendor?: string;
      architecture?: string;
      device?: string;
      description?: string;
    };
  } | null>;
}

async function webgpuInfo(): Promise<string> {
  const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;
  if (!gpu) return "Not available (no navigator.gpu)";
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return "No adapter offered";
    const i = adapter.info ?? {};
    const parts = [i.vendor, i.architecture, i.device, i.description].filter(
      (p): p is string => Boolean(p),
    );
    return parts.length ? parts.join(", ") : "An adapter, with no details";
  } catch (e) {
    return `requestAdapter failed: ${errorText(e)}`;
  }
}

/** A context of `kind` on a fresh canvas, or why the browser refused one:
 * the statusMessage of its webglcontextcreationerror, which in Firefox
 * names the blocklist entry or driver failure (what about:support shows). */
export function tryContext(
  kind: "webgl2" | "webgl",
  canvas = document.createElement("canvas"),
  options?: WebGLContextAttributes,
): WebGLRenderingContext | { refused: string } {
  let reason = "";
  // Fired synchronously, inside getContext.
  canvas.addEventListener("webglcontextcreationerror", (e) => {
    reason = (e as WebGLContextEvent).statusMessage;
  });
  const gl = canvas.getContext(kind, options) as WebGLRenderingContext | null;
  return gl ?? { refused: reason.trim() || "no reason given" };
}

function webglInfo(): string {
  try {
    const gl2 = tryContext("webgl2");
    const gl = "refused" in gl2 ? tryContext("webgl") : gl2;
    const why2 = "refused" in gl2 ? `WebGL2 refused: ${gl2.refused}` : "";
    if ("refused" in gl) return `${why2}. WebGL1 refused: ${gl.refused}`;
    const version = gl instanceof WebGL2RenderingContext ? "WebGL2" : "WebGL1";
    // Firefox has deprecated the extension and answers RENDERER, but with a
    // generic name ("…, or similar") unless webgl.sanitize-unmasked-renderer
    // is off.
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(
      gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
    );
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return why2
      ? `${version}: ${renderer}. ${why2}`
      : `${version}: ${renderer}`;
  } catch (e) {
    return `Couldn't ask: ${errorText(e)}`;
  }
}

/** Everything a report about `code` would carry, gathered now. */
export async function gatherReport(
  code: ReportCode,
  message: string,
  selftest = "",
): Promise<Report> {
  return {
    code,
    message: message || (isFailureCode(code) ? FAILURE_CODES[code] : ""),
    // A patch of their own lives only in their browser: its id tells the
    // crew nothing (playground/urls.ts). Built-ins keep their names.
    page: location.pathname.replace(/^(\/playground\/p\/)[^/]+/, "$1…"),
    build: __BUILD_ID__,
    browser: navigator.userAgent,
    webgpu: await webgpuInfo(),
    webgl: webglInfo(),
    screen: `${innerWidth}×${innerHeight} at ${devicePixelRatio}×`,
    selftest,
  };
}

/** What "Include my pattern" adds, in words: its name, size, and the
 * images it holds (a Still node keeps its image inside the patch). */
export function patchSummary(doc: PatchDoc): string {
  const json = JSON.stringify(doc);
  const kb = Math.max(
    1,
    Math.round(new TextEncoder().encode(json).length / 1024),
  );
  const images = json.split('"data:image/').length - 1;
  const parts = [
    `${doc.nodes.length} ${doc.nodes.length === 1 ? "node" : "nodes"}`,
    `${kb} KB`,
  ];
  if (images) parts.push(`${images} ${images === 1 ? "image" : "images"}`);
  return `“${doc.name || "Untitled"}”: ${parts.join(", ")}`;
}

/** Send a report; throws with the server's own words if it refuses. */
export async function sendReport(
  report: Report,
  extra: {
    note: string;
    contact: string;
    turnstile: string;
    /** The visitor's pattern, only when they chose to include it. */
    patch?: PatchDoc;
  },
): Promise<void> {
  const res = await fetch("/api/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...report, ...extra }),
  });
  const out = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(out.error ?? `The server said ${res.status}.`);
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
