import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("playground", "routes/playground.tsx"),
  // The crew's notifications page (noindex; see app/admin).
  route("admin", "routes/admin.tsx"),
  // A concrete `/404` so prerendering emits a real static 404 document — a
  // splat route has no path to prerender, which would leave the host with
  // nothing to serve but the empty SPA shell.
  route("404", "routes/404.tsx"),
  route("*", "routes/404.tsx", { id: "catch-all" }),
] satisfies RouteConfig;
