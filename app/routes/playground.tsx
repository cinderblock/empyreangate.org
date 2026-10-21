import { lazy, Suspense, useEffect, useState } from "react";
import type { MetaFunction } from "react-router";
import ReportProblem from "../components/ReportProblem";
import { PLAYGROUND, SITE } from "../content/site";
import { countFailure, errorText } from "../failures";

export const meta: MetaFunction = () => {
  const title = `Pattern playground · ${SITE.name}`;
  const description =
    "Build a light pattern for The Empyrean Gate in your browser, with the gate's own node editor and render engine.";
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: `${SITE.origin}/playground` },
    { property: "og:image", content: `${SITE.origin}/og.png` },
    { tagName: "link", rel: "canonical", href: `${SITE.url}/playground` },
    // Chrome's WebMCP origin trial, so the agent tools (playground/agent.ts)
    // reach the browser's agent without a flag. In the prerendered head, so
    // it is there before the script asks for document.modelContext.
    { httpEquiv: "origin-trial", content: PLAYGROUND.webmcpOriginTrial },
    // The guide for AI agents (generated at build: scripts/agent-docs.ts).
    {
      tagName: "link",
      rel: "alternate",
      type: "text/markdown",
      href: "/playground/agents.md",
      title: "Making patterns: the guide for AI agents",
    },
  ];
};

// The editor, the wasm core and WebGPU are browser-only and heavy; the
// prerendered page is a shell that loads them after hydration.
const Playground = lazy(() => import("../playground/Playground"));

function Loading() {
  return (
    <main id="main" className="pg-loading">
      <p className="kicker">Pattern playground</p>
      <p className="lede">Loading the gate's editor and render engine…</p>
      <noscript>
        <p>The playground runs in your browser and needs JavaScript.</p>
      </noscript>
    </main>
  );
}

export default function PlaygroundRoute() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <Loading />;
  return (
    <main id="main" className="pg-main">
      <Suspense fallback={<Loading />}>
        <Playground />
      </Suspense>
    </main>
  );
}

/**
 * The playground's code didn't load (most likely its chunk 404s right after
 * a deploy) or threw while starting. Without this the visitor would get
 * React Router's bare error page.
 */
export function ErrorBoundary({ error }: { error: unknown }) {
  const message = errorText(error);
  useEffect(() => countFailure("playground-load"), []);
  return (
    <main id="main" className="pg-loading">
      <p className="kicker">Pattern playground</p>
      <p className="lede">The playground didn't load.</p>
      <p className="pg-load-error">
        Reloading the page usually fixes it. If it doesn't, please tell us.
      </p>
      <p className="pg-load-actions">
        <button
          type="button"
          className="button"
          onClick={() => location.reload()}
        >
          Reload
        </button>{" "}
        <ReportProblem code="playground-load" message={message} />
      </p>
    </main>
  );
}
