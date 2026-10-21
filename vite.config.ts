import { reactRouter } from "@react-router/dev/vite";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineConfig, searchForWorkspaceRoot, type Plugin } from "vite";
import { buildId, siteOrigin } from "./scripts/build-context";

// Developing the playground against a local gate checkout: `PATCH_WEB_DIR`
// names its packages/patch-web (with the wasm built), and these aliases take
// the package's entry points from there instead of the installed web-dist, so
// neither package.json nor bun.lock changes. Its React and React Flow are
// deduped onto this project's copies, or hooks would see two Reacts.
const patchWebDir = process.env.PATCH_WEB_DIR?.replace(/\\/g, "/");
const patchWebAlias = patchWebDir
  ? [
      {
        find: "@empyrean-gate/patch-web/editor.css",
        replacement: `${patchWebDir}/src/editor/editor.css`,
      },
      {
        find: "@empyrean-gate/patch-web/editor",
        replacement: `${patchWebDir}/src/editor/index.ts`,
      },
      {
        find: "@empyrean-gate/patch-web/files",
        replacement: `${patchWebDir}/src/editor/files.ts`,
      },
      {
        find: "@empyrean-gate/patch-web/runtime",
        replacement: `${patchWebDir}/src/runtime/index.ts`,
      },
      {
        find: "@empyrean-gate/patch-web/types",
        replacement: `${patchWebDir}/src/types.ts`,
      },
      {
        find: "@empyrean-gate/patch-web/agent",
        replacement: `${patchWebDir}/src/agent/index.ts`,
      },
    ]
  : [];

// `vite preview` serves the built site to the Playwright suite. Unlike Workers
// static assets (html_handling auto-trailing-slash), it answers a bare
// `/playground` with the SPA fallback, the home page, which React Router then
// hydrates against the wrong markup. Redirect to the directory form, as the
// deploy does, so tests see the page a visitor sees.
function trailingSlashLikeTheDeploy(): Plugin {
  return {
    name: "trailing-slash-like-the-deploy",
    configurePreviewServer(server) {
      const outDir = resolve(server.config.root, server.config.build.outDir);
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://x");
        const path = url.pathname;
        if (
          path !== "/" &&
          !path.endsWith("/") &&
          !/\.[a-z0-9]+$/i.test(path) &&
          existsSync(join(outDir, path, "index.html"))
        ) {
          res.statusCode = 307;
          res.setHeader("location", `${path}/${url.search}`);
          res.end();
          return;
        }
        next();
      });
    },
  };
}

// The deploy also applies `_redirects` (public/_redirects): its rewrites
// (status 200, a trailing `*`) serve one page for many paths, as the
// playground's patch URLs need. `vite preview` knows nothing of the file, so
// apply those rules the same way here; the tests then exercise the real file.
function rewritesLikeTheDeploy(): Plugin {
  return {
    name: "rewrites-like-the-deploy",
    configurePreviewServer(server) {
      const outDir = resolve(server.config.root, server.config.build.outDir);
      const file = join(outDir, "_redirects");
      const rules = existsSync(file)
        ? readFileSync(file, "utf8")
            .split(/\r?\n/)
            .map((line) => line.trim().split(/\s+/))
            .filter(
              ([from, , status]) =>
                status === "200" && from !== undefined && from.endsWith("*"),
            )
            .map(([from, to]) => ({ prefix: from!.slice(0, -1), to: to! }))
        : [];
      server.middlewares.use((req, _res, next) => {
        const url = new URL(req.url ?? "/", "http://x");
        const rule = rules.find((r) => url.pathname.startsWith(r.prefix));
        if (rule) req.url = rule.to + url.search;
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    reactRouter(),
    rewritesLikeTheDeploy(),
    trailingSlashLikeTheDeploy(),
  ],
  resolve: {
    alias: patchWebAlias,
    dedupe: ["react", "react-dom", "@xyflow/react"],
  },
  // Where this build is served: production, or a Preview's own subdomain;
  // and which build it is, for failure counts and reports. See
  // scripts/build-context.ts.
  define: {
    __SITE_ORIGIN__: JSON.stringify(siteOrigin(process.env)),
    __BUILD_ID__: JSON.stringify(buildId(process.env)),
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["noook", "noook.tsl"],
    // Developing the playground against a local gate checkout (a `file:` or
    // `link:` dependency on its packages/patch-web): let the dev server read
    // that directory too, or the wasm fetch is refused. See README.
    fs: process.env.PATCH_WEB_DIR
      ? {
          allow: [
            searchForWorkspaceRoot(process.cwd()),
            process.env.PATCH_WEB_DIR,
          ],
        }
      : undefined,
  },
  // The patch core's wasm is located with `new URL(..., import.meta.url)`,
  // which pre-bundling would break by moving the JS away from the .wasm.
  // Excluding it also hides its imports from the dependency scan, so its
  // React Flow (whose zustand needs a CommonJS shim converted) is pre-bundled
  // by name.
  optimizeDeps: {
    exclude: ["@empyrean-gate/patch-web"],
    include: ["@xyflow/react"],
  },
});
