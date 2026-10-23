/**
 * "What's missing?": a button, and a dialog that says what this browser
 * lacks for the playground and runs a short test of it in the page
 * (browser-check.ts). Nothing is sent from here: Send hands the results to
 * the usual report dialog (ReportProblem.tsx), which shows every field
 * before anything leaves.
 *
 * On a Linux desktop it also offers the GPU check script
 * (scripts/linux-gpu-check.sh), pinned to this build's commit.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CHECK_USES,
  formatCheck,
  isLinuxDesktop,
  runBrowserCheck,
  webgpuAdvice,
  type CheckResult,
  type CheckState,
} from "../browser-check";
import { SITE } from "../content/site";
import { ReportDialog } from "./ReportProblem";

const STATE_LABEL: Record<CheckState, string> = {
  works: "Works",
  limited: "Limited",
  missing: "Missing",
};

/** The Linux script, at the commit this build came from. */
const SCRIPT_URL = `${SITE.source.replace("https://github.com/", "https://raw.githubusercontent.com/")}/${
  __BUILD_ID__ === "local" ? "dev" : __BUILD_ID__
}/scripts/linux-gpu-check.sh`;

export default function BrowserCheck({
  summary,
  preview,
  className,
}: {
  /** What reduced mode means here, in a sentence (also the report's
   * "What went wrong"). */
  summary: string;
  /** Why the playground's live preview didn't start, as the runtime said. */
  preview?: string;
  className?: string;
}) {
  const [view, setView] = useState<
    { kind: "closed" } | { kind: "check" } | { kind: "send"; results: string }
  >({ kind: "closed" });
  return (
    <>
      <button
        type="button"
        className={className ? `report-button ${className}` : "report-button"}
        onClick={() => setView({ kind: "check" })}
      >
        What's missing?
      </button>
      {view.kind === "check" &&
        createPortal(
          <CheckDialog
            summary={summary}
            preview={preview}
            onSend={(results) => setView({ kind: "send", results })}
            onClose={() =>
              setView((v) => (v.kind === "check" ? { kind: "closed" } : v))
            }
          />,
          document.body,
        )}
      {view.kind === "send" &&
        createPortal(
          <ReportDialog
            code="browser-check"
            message={summary}
            selftest={view.results}
            patch={null}
            onClose={() => setView({ kind: "closed" })}
          />,
          document.body,
        )}
    </>
  );
}

function CheckDialog({
  summary,
  preview,
  onSend,
  onClose,
}: {
  summary: string;
  preview?: string;
  onSend: (results: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [results, setResults] = useState<CheckResult[] | null>(null);
  const [round, setRound] = useState(0);
  const [copied, setCopied] = useState(false);
  const ua = navigator.userAgent;

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    let live = true;
    setResults(null);
    setCopied(false);
    void runBrowserCheck().then((r) => {
      if (live) setResults(r);
    });
    return () => {
      live = false;
    };
  }, [round]);

  const text = results ? formatCheck(results) : "";

  return (
    <dialog
      ref={dialogRef}
      className="dialog check-dialog"
      aria-labelledby="check-h"
      onClose={onClose}
    >
      <h2 id="check-h">What's missing</h2>
      <p className="report-intro">{summary}</p>
      {preview && (
        <p className="report-intro">
          The live preview said: <q>{preview}</q>
        </p>
      )}
      <p className="report-intro">
        A short test of this browser, run here in the page. Nothing is sent
        unless you choose to.
      </p>
      {results ? (
        <ul className="check-list">
          {results.map((r) => (
            <li key={r.key} data-state={r.state}>
              <span className="check-state">{STATE_LABEL[r.state]}</span>
              <div>
                <strong>{r.label}</strong>{" "}
                <span className="check-use">{CHECK_USES[r.key]}</span>
                <p className="check-detail">{r.detail}</p>
                {r.key === "webgpu" && r.state === "missing" && (
                  <p className="check-advice">{webgpuAdvice(ua, r)}</p>
                )}
                {r.key === "webgpu" && r.state !== "missing" && preview && (
                  <p className="check-advice">
                    It works now, though the live preview didn't start.
                    Reloading the page tries again.
                  </p>
                )}
                {r.key === "webgl2" &&
                  r.state === "missing" &&
                  /Firefox\//.test(ua) && (
                    <p className="check-advice">
                      about:support's Graphics section says why Firefox turned
                      it off, often a GPU driver it blocks.
                    </p>
                  )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="report-intro" role="status">
          Testing…
        </p>
      )}
      {isLinuxDesktop(ua) && (
        <div className="check-linux">
          <p className="report-intro">
            On Linux, the graphics drivers matter too. This script looks over
            them and says what to install (open-source packages only). It only
            reads, and needs no sudo:
          </p>
          <pre>
            <code>{`curl -fsSLO ${SCRIPT_URL}\nbash linux-gpu-check.sh`}</code>
          </pre>
        </div>
      )}
      <div className="dialog-actions">
        <button
          type="button"
          disabled={!results}
          onClick={() => setRound((n) => n + 1)}
        >
          Test again
        </button>
        <button
          type="button"
          disabled={!results}
          onClick={() =>
            void navigator.clipboard
              ?.writeText(`${summary}\n${text}\n${ua}`)
              .then(() => setCopied(true))
          }
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" onClick={() => dialogRef.current?.close()}>
          Close
        </button>
        <button
          type="button"
          className="dialog-primary"
          disabled={!results}
          onClick={() => onSend(text)}
        >
          Send the results…
        </button>
      </div>
    </dialog>
  );
}
