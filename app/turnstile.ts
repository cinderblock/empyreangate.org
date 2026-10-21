/**
 * Cloudflare Turnstile, the spam check in front of everything a visitor can
 * send us: the playground's Submit and "Send a report". The script loads
 * once, only when a dialog that needs it opens.
 */

import { useEffect, useRef, useState } from "react";
import { PLAYGROUND } from "./content/site";

interface Turnstile {
  render(
    el: HTMLElement,
    options: {
      sitekey: string;
      theme?: "dark" | "light" | "auto";
      callback: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    },
  ): string;
  reset(id: string): void;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let turnstileLoading: Promise<Turnstile> | null = null;

function loadTurnstile(): Promise<Turnstile> {
  turnstileLoading ??= new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const script = document.createElement("script");
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () =>
      window.turnstile
        ? resolve(window.turnstile)
        : reject(new Error("Turnstile did not load"));
    script.onerror = () => {
      turnstileLoading = null;
      reject(new Error("The spam check could not load."));
    };
    document.head.append(script);
  });
  return turnstileLoading;
}

/**
 * A Turnstile widget rendered into `widgetRef`'s element: the token once the
 * check passes (null before, and after it expires), the error if the script
 * can't load, and `reset` for after a failed send (a token is good once).
 */
export function useTurnstile() {
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void loadTurnstile()
      .then((ts) => {
        if (!live || !widgetRef.current) return;
        widgetId.current = ts.render(widgetRef.current, {
          sitekey: PLAYGROUND.turnstileSiteKey,
          theme: "dark",
          callback: setToken,
          "expired-callback": () => setToken(null),
          "error-callback": () => setToken(null),
        });
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
    };
  }, []);

  const reset = () => {
    setToken(null);
    if (widgetId.current) window.turnstile?.reset(widgetId.current);
  };

  return { widgetRef, token, error, reset };
}
