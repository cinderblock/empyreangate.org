// The crew's notifications page: install the site as an app, present the
// admin token, and this device gets a push for every pattern submitted
// (worker/index.ts `/api/notify/*`, public/sw.js).

import { useEffect, useState, type FormEvent } from "react";
import "./admin.css";

const TOKEN_KEY = "empyrean-admin-token";

type State =
  | { kind: "checking" }
  | { kind: "unsupported"; why: string }
  | { kind: "unconfigured" }
  | { kind: "off" }
  | { kind: "on"; endpoint: string }
  | { kind: "busy"; what: string };

/** Standalone display = installed (what iOS needs before it allows push). */
function isInstalled(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

export function base64urlToBytes(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function api(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
}

async function message(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export default function Admin() {
  const [token, setToken] = useState(
    () => localStorage.getItem(TOKEN_KEY) ?? "",
  );
  const [state, setState] = useState<State>({ kind: "checking" });
  const [note, setNote] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);

  // What this browser can do, and whether this build has push set up.
  useEffect(() => {
    let stale = false;
    (async () => {
      if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        setState({
          kind: "unsupported",
          why: isIos()
            ? "On an iPhone, add this page to your Home Screen first (Share → Add to Home Screen), then open it from there."
            : "This browser can't receive push notifications.",
        });
        return;
      }
      const res = await fetch("/api/notify/key").catch(() => null);
      if (stale) return;
      if (!res || !res.ok) {
        setState({ kind: "unconfigured" });
        return;
      }
      const { key } = (await res.json()) as { key: string };
      setKey(key);
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (stale) return;
      setState(sub ? { kind: "on", endpoint: sub.endpoint } : { kind: "off" });
    })().catch((e: unknown) => {
      if (!stale)
        setState({
          kind: "unsupported",
          why: e instanceof Error ? e.message : String(e),
        });
    });
    return () => {
      stale = true;
    };
  }, []);

  const saveToken = (e: FormEvent) => {
    e.preventDefault();
    localStorage.setItem(TOKEN_KEY, token.trim());
    setToken(token.trim());
    setNote("Token kept on this device.");
  };

  const turnOn = async () => {
    if (!key) return;
    setNote(null);
    setState({ kind: "busy", what: "Asking for permission…" });
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState({ kind: "off" });
        setNote(
          "Notifications were not allowed. Allow them for this site in the browser's settings and try again.",
        );
        return;
      }
      setState({ kind: "busy", what: "Subscribing this device…" });
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64urlToBytes(key) as BufferSource,
        }));
      const res = await api("/api/notify/subscribe", token, {
        method: "POST",
        body: JSON.stringify({
          subscription: sub.toJSON(),
          label: `${navigator.platform} · ${new Date().toLocaleDateString()}`,
        }),
      });
      if (!res.ok) {
        await sub.unsubscribe().catch(() => undefined);
        setState({ kind: "off" });
        setNote(await message(res, "The gate's server refused this device."));
        return;
      }
      setState({ kind: "on", endpoint: sub.endpoint });
      setNote("This device will be told about every new pattern.");
    } catch (e) {
      setState({ kind: "off" });
      setNote(e instanceof Error ? e.message : String(e));
    }
  };

  const turnOff = async () => {
    setNote(null);
    setState({ kind: "busy", what: "Removing this device…" });
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await api("/api/notify/subscribe", token, {
          method: "DELETE",
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setState({ kind: "off" });
      setNote("This device is off the list.");
    } catch (e) {
      setState({ kind: "off" });
      setNote(e instanceof Error ? e.message : String(e));
    }
  };

  const sendTest = async () => {
    setNote(null);
    const res = await api("/api/notify/test", token, {
      method: "POST",
      body: "{}",
    });
    if (!res.ok) {
      setNote(await message(res, "The test could not be sent."));
      return;
    }
    const { sent } = (await res.json()) as { sent: number };
    setNote(
      sent === 0
        ? "No device accepted the test."
        : `Sent to ${sent} device${sent === 1 ? "" : "s"}.`,
    );
  };

  const installed = typeof window !== "undefined" && isInstalled();

  return (
    <main id="main" className="admin">
      <p className="kicker">Crew</p>
      <h1>Notifications</h1>
      <p className="lede">
        Get a notification on this device whenever someone submits a pattern
        from the playground.
      </p>

      <section className="admin-card" aria-labelledby="admin-token-head">
        <h2 id="admin-token-head">1. The admin token</h2>
        <form onSubmit={saveToken} className="admin-token">
          <label>
            <span>Token</span>
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ask Cameron"
            />
          </label>
          <button type="submit" className="button">
            Keep on this device
          </button>
        </form>
      </section>

      <section className="admin-card" aria-labelledby="admin-device-head">
        <h2 id="admin-device-head">2. This device</h2>
        {!installed && (
          <p className="hint">
            For the most reliable delivery, install the site first: on an
            iPhone, Share → Add to Home Screen (required there); on Android or
            desktop Chrome, the install option in the browser menu. Then open it
            from the icon.
          </p>
        )}
        {state.kind === "checking" && (
          <p data-admin="checking">Checking this browser…</p>
        )}
        {state.kind === "unsupported" && (
          <p data-admin="unsupported">{state.why}</p>
        )}
        {state.kind === "unconfigured" && (
          <p data-admin="unconfigured">
            Notifications aren't set up on this build yet.
          </p>
        )}
        {state.kind === "busy" && <p data-admin="busy">{state.what}</p>}
        {state.kind === "off" && (
          <button
            type="button"
            className="button"
            onClick={turnOn}
            disabled={!token}
            data-admin="off"
          >
            Turn on notifications here
          </button>
        )}
        {state.kind === "on" && (
          <div className="admin-actions" data-admin="on">
            <p>Notifications are on for this device.</p>
            <button
              type="button"
              className="button"
              onClick={sendTest}
              disabled={!token}
            >
              Send a test
            </button>
            <button
              type="button"
              className="button button-quiet"
              onClick={turnOff}
            >
              Turn off
            </button>
          </div>
        )}
        {!token && state.kind === "off" && (
          <p className="hint">Enter the token first.</p>
        )}
        {note && (
          <p className="admin-note" role="status">
            {note}
          </p>
        )}
      </section>
    </main>
  );
}
