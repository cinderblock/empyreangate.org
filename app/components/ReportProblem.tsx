/**
 * "Send a report", on the screen where something failed: a button, and a
 * dialog that shows every field the report would carry before anything is
 * sent. An optional note and contact, then Turnstile, then
 * `POST /api/report` (worker/index.ts), which stores it for the crew.
 *
 * The button is phrasing content, so it can sit inside a failure message's
 * paragraph; the dialog goes to the end of the body.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import {
  errorText,
  gatherReport,
  REPORT_FIELDS,
  sendReport,
  type FailureCode,
  type Report,
} from "../failures";
import { useTurnstile } from "../turnstile";

export default function ReportProblem({
  code,
  message,
}: {
  code: FailureCode;
  /** The error as the page saw it. */
  message: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="report-button"
        onClick={() => setOpen(true)}
      >
        Send a report
      </button>
      {open &&
        createPortal(
          <ReportDialog
            code={code}
            message={message}
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

function ReportDialog({
  code,
  message,
  onClose,
}: {
  code: FailureCode;
  message: string;
  onClose: () => void;
}) {
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
    void gatherReport(code, message).then((r) => {
      if (live) setReport(r);
    });
    return () => {
      live = false;
    };
  }, [code, message]);

  const send = async () => {
    if (!report || !turnstile.token) return;
    setPhase({ kind: "sending" });
    try {
      await sendReport(report, { note, contact, turnstile: turnstile.token });
      setPhase({ kind: "sent" });
    } catch (e) {
      setPhase({ kind: "error", message: errorText(e) });
      turnstile.reset();
    }
  };

  const canSend =
    report !== null && turnstile.token !== null && phase.kind !== "sending";

  return (
    <dialog
      ref={dialogRef}
      className="dialog report-dialog"
      aria-labelledby="report-h"
      onClose={onClose}
    >
      <h2 id="report-h">Send a report</h2>
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
          <p className="report-intro">
            This sends the crew what's below, so we can work out what broke.
            Nothing else is sent, and nothing is sent until you press Send. See{" "}
            <Link to="/privacy">privacy</Link>.
          </p>
          {report ? (
            <dl className="report-fields">
              {REPORT_FIELDS.map(({ key, label }) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{report[key]}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="report-intro">Gathering the details…</p>
          )}
          <label>
            Anything to add? (optional)
            <textarea
              maxLength={2000}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What you were doing, what you expected…"
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
