/**
 * "Play it live", shown only while the gate's public floor answers. The
 * prerendered page knows nothing about the gate; once mounted, the browser
 * asks this site's Worker (`/api/live`, worker/index.ts), which keeps the
 * floor's answer for a few seconds so the gate hears from a few edges, not
 * from every visitor. Nothing renders until the answer is in, so the
 * prerendered HTML and the first client render agree.
 */

import { useEffect, useState } from "react";

/** The Worker's `/api/live` body. */
export interface Live {
  live: boolean;
  /** Where to play, when live. */
  url?: string;
  open?: boolean;
  players?: number;
  nowPlaying?: { name: string; credit: string } | null;
}

/** How often an open page asks again. */
const REFRESH_MS = 60_000;

export function useLive(): Live | null {
  const [live, setLive] = useState<Live | null>(null);
  useEffect(() => {
    let stale = false;
    const ask = () =>
      fetch("/api/live", { headers: { accept: "application/json" } })
        .then((r) => (r.ok ? (r.json() as Promise<Live>) : { live: false }))
        .then((l) => {
          if (!stale) setLive(l);
        })
        .catch(() => {
          if (!stale) setLive({ live: false });
        });
    void ask();
    const timer = window.setInterval(() => void ask(), REFRESH_MS);
    return () => {
      stale = true;
      window.clearInterval(timer);
    };
  }, []);
  return live;
}

/** The link to the floor: a hero button, or the playground bar's chip. */
export function PlayLive({
  live,
  className,
}: {
  live: Live | null;
  className?: string;
}) {
  if (!live?.live || !live.url) return null;
  return (
    <a
      className={className}
      href={live.url}
      rel="noopener"
      target="_blank"
      title={
        live.open === false
          ? "The gate is up; the floor is closed for the moment"
          : "Play the gate from your phone, right now"
      }
    >
      Play it live ↗
    </a>
  );
}

/** What is on the gate, when a patch is on air. */
export function NowPlaying({ live }: { live: Live | null }) {
  if (!live?.live || !live.nowPlaying?.name) return null;
  const { name, credit } = live.nowPlaying;
  return (
    <p className="hero-next now-playing">
      <span className="hero-next-label">On now</span>{" "}
      <span className="now-playing-name">{name}</span>
      {credit ? <> by {credit}</> : null}
    </p>
  );
}
