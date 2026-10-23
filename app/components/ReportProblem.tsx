/**
 * "Send a report", on the screen where something failed: a button, and a
 * dialog that shows every field the report would carry before anything is
 * sent. An optional note and contact, then Turnstile, then
 * `POST /api/report` (worker/index.ts), which stores it for the crew.
 *
 * With `code="user-report"` it is "Report a problem" instead, for something
 * the visitor noticed themselves: no error to show, so their note leads and
 * is required.
 *
 * Given `patch` (the playground's), the dialog offers to include it,
 * unticked, saying what it holds.
 *
 * The browser check (BrowserCheck.tsx) opens the dialog itself
 * (`ReportDialog`), with its results as `selftest`.
 *
 * The button is phrasing content, so it can sit inside a failure message's
 * paragraph; the dialog goes to the end of the body.
 */

import type { PatchDoc } from "@empyrean-gate/patch-web/types";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import {
  errorText,
  gatherReport,
  patchSummary,
  REPORT_FIELDS,
  sendReport,
  type Report,
  type ReportCode,
} from "../failures";
import { useTurnstile } from "../turnstile";

export default function ReportProblem({
  code,
  message = "",
  patch,
  className,
}: {
  code: ReportCode;
  /** The error as the page saw it; none for a `user-report`. */
  message?: string;
  /** The visitor's pattern, offered for the report (never sent unasked). */
  patch?: PatchDoc | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className ? `report-button ${className}` : "report-button"}
        onClick={() => setOpen(true)}
      >
        {code === "user-report" ? "Report a problem" : "Send a report"}
      </button>
      {open &&
        createPortal(
          <ReportDialog
            code={code}
            message={message}
            patch={patch ?? null}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </>
  );
}

type Phase =
  | { kind: "form" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

export function ReportDialog({
  code,
  message,
  selftest = "",
  patch,
  onClose,
}: {
  code: ReportCode;
  message: string;
  /** The browser check's results, as a report carries them. */
  selftest?: string;
  patch: PatchDoc | null;
  onClose: () => void;
}) {
  const own = code === "user-report";
  const [withPatch, setWithPatch] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [note, setNote] = useState("");
  const [contact, setContact] = useState("");
  const turnstile = useTurnstile();
  const [phase, setPhase] = useState<Phase>({ kind: "form" });

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    let live = true;
    void gatherReport(code, message, selftest).then((r) => {
      if (live) setReport(r);
    });
    return () => {
      live = false;
    };
  }, [code, message, selftest]);

  const send = async () => {
    if (!report || !turnstile.token || (own && !note.trim())) return;
    setPhase({ kind: "sending" });
    try {
      await sendReport(report, {
        note,
        contact,
        turnstile: turnstile.token,
        ...(withPatch && patch ? { patch } : {}),
      });
      setPhase({ kind: "sent" });
    } catch (e) {
      setPhase({ kind: "error", message: errorText(e) });
      turnstile.reset();
    }
  };

  const canSend =
    report !== null &&
    turnstile.token !== null &&
    (!own || note.trim() !== "") &&
    phase.kind !== "sending";

  const noteField = (
    <label>
      {own ? "What went wrong?" : "Anything to add? (optional)"}
      <textarea
        maxLength={2000}
        rows={own ? 4 : 3}
        required={own}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={
          own
            ? "What you were doing, what you saw, what you expected…"
            : "What you were doing, what you expected…"
        }
      />
    </label>
  );

  return (
    <dialog
      ref={dialogRef}
      className="dialog report-dialog"
      aria-labelledby="report-h"
      onClose={onClose}
    >
      <h2 id="report-h">{own ? "Report a problem" : "Send a report"}</h2>
      {phase.kind === "sent" ? (
        <>
          <p>Thank you. The crew will look into it.</p>
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
          {own && noteField}
          <p className="report-intro">
            {own
              ? "This sends the crew your note and what's below, so we can work out what's wrong."
              : code === "browser-check"
                ? "This sends the crew what's below, so we can work out what this browser needs."
                : "This sends the crew what's below, so we can work out what broke."}{" "}
            Nothing else is sent, and nothing is sent until you press Send. See{" "}
            <Link to="/privacy">privacy</Link>.
          </p>
          {report ? (
            <dl className="report-fields">
              {REPORT_FIELDS.filter(({ key }) => report[key] !== "").map(
                ({ key, label }) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>{report[key]}</dd>
                  </div>
                ),
              )}
            </dl>
          ) : (
            <p className="report-intro">Gathering the details…</p>
          )}
          {!own && noteField}
          {patch && (
            <label className="dialog-terms">
              <input
                type="checkbox"
                checked={withPatch}
                onChange={(e) => setWithPatch(e.target.checked)}
              />
              <span>
                Include my pattern, so the crew can run it:{" "}
                {patchSummary(patch)}
              </span>
            </label>
          )}
          <label>
            Contact, if you'd like to hear back (optional)
            <input
              maxLength={200}
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="Email or Instagram"
            />
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
              {phase.kind === "sending" ? "Sending…" : "Send"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
