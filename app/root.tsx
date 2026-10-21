import { useEffect } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import "@fontsource-variable/cormorant/index.css";
import "@fontsource-variable/inter/index.css";
import "./styles/global.css";
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
  // The page started: the watchdog stops waiting for it.
  useEffect(() => {
    document.documentElement.setAttribute("data-hydrated", "");
  }, []);
  return <Outlet />;
}
