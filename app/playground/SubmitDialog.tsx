/**
 * Submit a pattern to the crew: name, optional contact and note, the terms,
 * and Cloudflare Turnstile as the spam check. Posts to `/api/submit`
 * (worker/index.ts), which stores it for review. Nothing is published
 * automatically.
 */

import type { PatchDoc } from "@empyrean-gate/patch-web/editor";
import { useEffect, useRef, useState } from "react";
import { PLAYGROUND } from "../content/site";

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

/** Load Turnstile's script once, only when someone opens the dialog. */
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

type Phase =
  | { kind: "form" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

export default function SubmitDialog({
  doc,
  problem,
  onClose,
}: {
  doc: PatchDoc;
  /** Why this patch can't run (it can't be submitted then). */
  problem: string | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

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
      .catch((e: unknown) =>
        setPhase({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    return () => {
      live = false;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
    };
  }, []);

  const send = async () => {
    setPhase({ kind: "sending" });
    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patch: doc,
          name,
          contact,
          message,
          agreed,
          turnstile: token,
        }),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok)
        throw new Error(out.error ?? `The server said ${res.status}.`);
      setPhase({ kind: "sent" });
    } catch (e) {
      setPhase({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
      setToken(null);
      if (widgetId.current) window.turnstile?.reset(widgetId.current);
    }
  };

  const canSend =
    !problem &&
    name.trim() !== "" &&
    agreed &&
    token !== null &&
    phase.kind !== "sending";

  return (
    <dialog
      ref={dialogRef}
      className="pg-dialog"
      aria-labelledby="pg-submit-h"
      onClose={onClose}
    >
      <h2 id="pg-submit-h">Submit “{doc.name}”</h2>
      {phase.kind === "sent" ? (
        <>
          <p>
            Thank you. The crew will look at it, and it may light up the gate.
            Keep your own copy with Save to disk.
          </p>
          <div className="pg-dialog-actions">
            <button type="button" onClick={() => dialogRef.current?.close()}>
              Close
            </button>
          </div>
        </>
      ) : (
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSend) void send();
          }}
        >
          {problem && (
            <p className="pg-dialog-problem">
              This patch can't run yet, so it can't be submitted: {problem}
            </p>
          )}
          <label>
            Your name, as you'd like to be credited
            <input
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </label>
          <label>
            Contact, if you'd like to hear back (optional)
            <input
              maxLength={200}
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="Email or Instagram"
            />
          </label>
          <label>
            A note (optional)
            <textarea
              maxLength={2000}
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What it's for, which song, how to play it…"
            />
          </label>
          <label className="pg-dialog-terms">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>{PLAYGROUND.terms}</span>
          </label>
          <div ref={widgetRef} className="pg-turnstile" />
          {phase.kind === "error" && (
            <p className="pg-dialog-problem" role="alert">
              {phase.message}
            </p>
          )}
          <div className="pg-dialog-actions">
            <button type="button" onClick={() => dialogRef.current?.close()}>
              Cancel
            </button>
            <button type="submit" className="pg-primary" disabled={!canSend}>
              {phase.kind === "sending" ? "Sending…" : "Submit"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
