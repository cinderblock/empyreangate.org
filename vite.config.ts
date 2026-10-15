import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import { siteOrigin } from "./scripts/build-context";

export default defineConfig({
  plugins: [reactRouter()],
  // Where this build is served: production, or a Preview's own subdomain.
  // See scripts/build-context.ts.
  define: {
    __SITE_ORIGIN__: JSON.stringify(siteOrigin(process.env)),
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
