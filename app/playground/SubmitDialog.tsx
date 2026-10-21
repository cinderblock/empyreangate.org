/**
 * Submit a pattern to the crew: name, optional contact and note, the terms,
 * and Cloudflare Turnstile as the spam check. Posts to `/api/submit`
 * (worker/index.ts), which stores it for review. Nothing is published
 * automatically.
 */

import type { PatchDoc } from "@empyrean-gate/patch-web/editor";
import { useEffect, useRef, useState } from "react";
import { PLAYGROUND } from "../content/site";
import { useTurnstile } from "../turnstile";

type Phase =
  | { kind: "form" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

export default function SubmitDialog({
  doc,
  problem,
  initial = {},
  onClose,
}: {
  doc: PatchDoc;
  /** Why this patch can't run (it can't be submitted then). */
  problem: string | null;
  /** Filled in by an agent that opened the dialog for the person. */
  initial?: { name?: string; note?: string };
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(initial.name ?? "");
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState(initial.note ?? "");
  const [agreed, setAgreed] = useState(false);
  const turnstile = useTurnstile();
  const [phase, setPhase] = useState<Phase>({ kind: "form" });

  useEffect(() => {
    dialogRef.current?.showModal();
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
          turnstile: turnstile.token,
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
      turnstile.reset();
    }
  };

  const canSend =
    !problem &&
    name.trim() !== "" &&
    agreed &&
    turnstile.token !== null &&
    phase.kind !== "sending";

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
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
          <div className="dialog-actions">
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
            <p className="dialog-problem">
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
          <label className="dialog-terms">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>{PLAYGROUND.terms}</span>
          </label>
          <div ref={turnstile.widgetRef} className="turnstile" />
          {(phase.kind === "error" || turnstile.error) && (
            <p className="dialog-problem" role="alert">
              {phase.kind === "error" ? phase.message : turnstile.error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" onClick={() => dialogRef.current?.close()}>
              Cancel
            </button>
            <button
              type="submit"
              className="dialog-primary"
              disabled={!canSend}
            >
              {phase.kind === "sending" ? "Sending…" : "Submit"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
