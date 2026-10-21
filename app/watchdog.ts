/**
 * The failures no React code can see, because React never started: counted
 * by a small inline script in every page's head (root.tsx), ahead of the
 * module scripts it watches.
 *
 * - `asset-load`: one of the build's own scripts failed to load. A script or
 *   modulepreload under `/assets/`, or the inline module that imports them
 *   (a failed import fires `error` on that `<script>`). Scripts from other
 *   origins, such as the analytics beacon an ad blocker stops, don't count.
 * - `page-stuck`: the page still hasn't hydrated (root.tsx marks
 *   `<html data-hydrated>`) some seconds after `load`. This is the hang in
 *   ISSUES.md, where the manifest 404s right after a deploy.
 *
 * Same beacon and body as `countFailure` (failures.ts): the code and the
 * build, nothing else.
 */

/** How long after `load` a page may take to hydrate before it counts as stuck. */
export const STUCK_AFTER_MS = 20_000;

export function watchdogScript(build: string): string {
  return `(function () {
  var sent = {};
  function count(code) {
    if (sent[code]) return;
    sent[code] = 1;
    var body = JSON.stringify({ code: code, build: ${JSON.stringify(build)} });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon("/api/failure", body)) return;
    } catch (e) {}
    try {
      fetch("/api/failure", { method: "POST", body: body, keepalive: true });
    } catch (e) {}
  }
  addEventListener(
    "error",
    function (e) {
      var t = e.target;
      if (!t || !t.tagName) return;
      var url = t.tagName === "SCRIPT" ? t.src : t.tagName === "LINK" ? t.href : null;
      if (url === null) return;
      if (url ? url.indexOf(location.origin + "/assets/") === 0 : t.type === "module")
        count("asset-load");
    },
    true
  );
  addEventListener("load", function () {
    setTimeout(function () {
      if (!document.documentElement.hasAttribute("data-hydrated")) count("page-stuck");
    }, ${STUCK_AFTER_MS});
  });
})();`;
}
