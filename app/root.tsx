import { useEffect } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import "@fontsource-variable/cormorant/index.css";
import "@fontsource-variable/inter/index.css";
import "./styles/global.css";
import ReportProblem from "./components/ReportProblem";
import { SITE } from "./content/site";
import {
  countFailure,
  errorScript,
  errorText,
  watchUncaught,
} from "./failures";
import { watchdogScript } from "./watchdog";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#06060f" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        {/* Counts a page that never starts (app/watchdog.ts); first, so it
            is listening before the scripts below load. */}
        {!import.meta.env.DEV && (
          <script
            dangerouslySetInnerHTML={{ __html: watchdogScript(__BUILD_ID__) }}
          />
        )}
        <Meta />
        <Links />
      </head>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  // The page started: the watchdog stops waiting for it, and errors nobody
  // planned for are counted from here on.
  useEffect(() => {
    document.documentElement.setAttribute("data-hydrated", "");
    return watchUncaught();
  }, []);
  return <Outlet />;
}

/**
 * A page crashed while rendering (the playground has its own boundary).
 * Without this React Router would show its bare error page.
 */
export function ErrorBoundary({ error }: { error: unknown }) {
  const message = errorText(error);
  useEffect(() => {
    // It did start, so this isn't the watchdog's stuck page.
    document.documentElement.setAttribute("data-hydrated", "");
    countFailure("uncaught", errorScript(error) ?? undefined);
  }, [error]);
  return (
    <main id="main" className="notfound">
      <p className="kicker">{SITE.name}</p>
      <h1>Something went wrong.</h1>
      <p className="lede">
        This page hit an error. Reloading usually fixes it; if it doesn't,
        please tell us.
      </p>
      <p className="crash-actions">
        <button
          type="button"
          className="button"
          onClick={() => location.reload()}
        >
          Reload
        </button>{" "}
        <ReportProblem code="uncaught" message={message} />
      </p>
    </main>
  );
}
