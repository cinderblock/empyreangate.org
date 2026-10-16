import { lazy, Suspense, useEffect, useState } from "react";
import type { MetaFunction } from "react-router";
import { SITE } from "../content/site";

export const meta: MetaFunction = () => [
  { title: `Crew notifications · ${SITE.name}` },
  {
    name: "description",
    content:
      "Where the gate's crew turns on notifications for new pattern submissions.",
  },
  { name: "robots", content: "noindex" },
];

// Push subscriptions are browser-only; the prerendered page is a shell.
const Admin = lazy(() => import("../admin/Admin"));

function Loading() {
  return (
    <main id="main" className="admin">
      <p className="kicker">Crew</p>
      <h1>Notifications</h1>
      <p className="lede">Loading…</p>
      <noscript>
        <p>Turning notifications on needs JavaScript.</p>
      </noscript>
    </main>
  );
}

export default function AdminRoute() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <Loading />;
  return (
    <Suspense fallback={<Loading />}>
      <Admin />
    </Suspense>
  );
}
