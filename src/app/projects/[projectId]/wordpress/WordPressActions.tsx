"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./wordpress.module.css";

/**
 * Client actions for the staging WordPress step. Every write requires an
 * explicit typed confirmation naming the project, target, draft, and
 * operation. Server errors are shown as received (already redacted).
 */

type Phase = "idle" | "loading" | "success" | "error";

type ConfirmOp = {
  kind: "sync";
  label: string;
  description: string;
};

export default function WordPressActions({
  projectId,
  projectName,
  hasApprovedDraft,
  approvedDraftId,
  integrationEnabled,
  stagingHost,
}: {
  projectId: string;
  projectName: string;
  hasApprovedDraft: boolean;
  approvedDraftId: string | null;
  integrationEnabled: boolean;
  stagingHost: string | null;
}) {
  const [diagnosePhase, setDiagnosePhase] = useState<Phase>("idle");
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);
  const [dryRunPhase, setDryRunPhase] = useState<Phase>("idle");
  const [dryRun, setDryRun] = useState<Record<string, unknown> | null>(null);
  const [confirmOp, setConfirmOp] = useState<ConfirmOp | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [syncPhase, setSyncPhase] = useState<Phase>("idle");
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [readBackPhase, setReadBackPhase] = useState<Phase>("idle");
  const [readBackResult, setReadBackResult] = useState<string | null>(null);

  const base = `/api/projects/${projectId}/wordpress`;

  async function post(path: string, body?: unknown) {
    const res = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  }

  async function runDiagnose() {
    setDiagnosePhase("loading");
    setDiagnostics(null);
    const { status, json } = await post("/diagnose");
    if (status === 200 && json.ok) {
      setDiagnostics(json.diagnostics as Record<string, unknown>);
      setDiagnosePhase("success");
    } else {
      setDiagnosePhase("error");
    }
  }

  async function runDryRun() {
    setDryRunPhase("loading");
    setDryRun(null);
    const { status, json } = await post("/dry-run");
    if (status === 200 && json.ok) {
      setDryRun(json as Record<string, unknown>);
      setDryRunPhase("success");
    } else {
      setDryRun({ errors: json.errors ?? ["Dry run failed."] });
      setDryRunPhase("error");
    }
  }

  async function runSync() {
    if (!confirmOp) return;
    setSyncPhase("loading");
    setSyncResult(null);
    const { status, json } = await post("/sync", { confirm: true });
    setConfirmOp(null);
    setConfirmText("");
    if (status === 200 && json.ok) {
      setSyncResult(
        `Sync succeeded. Read-back ${json.readBackVerified ? "verified" : "NOT verified"}. ${json.detail ?? ""}`
      );
      setSyncPhase("success");
    } else {
      setSyncResult(
        `Sync failed (${status}). ${(json.errors as string[] | undefined)?.join(" ") ?? json.detail ?? "The previous staging content is unchanged."}`
      );
      setSyncPhase("error");
    }
  }

  async function runReadBack() {
    setReadBackPhase("loading");
    setReadBackResult(null);
    const { status, json } = await post("/read-back");
    if (status === 200 && json.ok) {
      setReadBackResult(`Read-back verified through HomeContentSchema. Hero title: "${(json.preview as { heroTitle?: string })?.heroTitle ?? ""}"`);
      setReadBackPhase("success");
    } else {
      setReadBackResult(
        `Read-back failed: ${(json.errors as string[] | undefined)?.join(" ") ?? "unknown error"}`
      );
      setReadBackPhase("error");
    }
  }

  const syncReady = integrationEnabled && hasApprovedDraft;

  return (
    <section className={styles.actions}>
      <h2 className={styles.cardTitle}>Operations</h2>
      <div className={styles.buttonRow}>
        <button
          type="button"
          className={styles.button}
          onClick={runDiagnose}
          disabled={diagnosePhase === "loading"}
        >
          {diagnosePhase === "loading" ? "Checking..." : "Diagnose connection"}
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={runDryRun}
          disabled={dryRunPhase === "loading"}
        >
          {dryRunPhase === "loading" ? "Computing..." : "Dry run (no writes)"}
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={runReadBack}
          disabled={readBackPhase === "loading" || !integrationEnabled}
        >
          {readBackPhase === "loading" ? "Reading..." : "Read-back verification"}
        </button>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonPrimary}`}
          disabled={!syncReady}
          onClick={() =>
            setConfirmOp({
              kind: "sync",
              label: "Sync approved content",
              description: `Write the approved draft ${approvedDraftId ?? ""} from project "${projectName}" to the staging site ${stagingHost ?? ""}. Only mapped content fields are written; nothing else on the site is modified.`,
            })
          }
        >
          Sync approved content
        </button>
      </div>

      {!integrationEnabled && (
        <p className={styles.warn}>
          Integration is disabled on the server (WORDPRESS_INTEGRATION_ENABLED).
          Diagnose and dry run still work offline; sync and read-back are
          unavailable.
        </p>
      )}
      {integrationEnabled && !hasApprovedDraft && (
        <p className={styles.warn}>
          No approved draft. Approve a draft on the Review step first - review
          and synchronization are separate actions.
        </p>
      )}

      {diagnostics && (
        <div className={styles.resultBox}>
          <strong>Diagnosis:</strong> {String(diagnostics.detail)}
          <ul className={styles.metaList}>
            <li>REST reachable: {String(diagnostics.restReachable)}</li>
            <li>Pages readable: {String(diagnostics.pagesReachable)}</li>
            <li>ACF-to-REST detected: {String(diagnostics.acfFieldGroupsReachable)}</li>
            <li>Field-group creation via REST: not supported (use the reviewed export)</li>
          </ul>
        </div>
      )}
      {diagnosePhase === "error" && (
        <p className={styles.error}>Diagnosis failed. Check the server configuration.</p>
      )}

      {dryRun && !dryRun.errors && (
        <div className={styles.resultBox}>
          <strong>Dry run:</strong> {String(dryRun.detail)}
          {Array.isArray((dryRun.dryRun as { fields?: unknown[] })?.fields) && (
            <ul className={styles.fieldList}>
              {((dryRun.dryRun as { fields: Array<{ internalPath: string; wpName: string; value: unknown }> }).fields).map(
                (f) => (
                  <li key={f.internalPath}>
                    <code>{f.internalPath}</code> &rarr; <code>{f.wpName}</code>
                  </li>
                )
              )}
            </ul>
          )}
          <p className={styles.muted}>
            Zero network requests were made by this dry run.
          </p>
        </div>
      )}
      {Boolean(dryRun?.errors) && (
        <p className={styles.error}>{((dryRun?.errors as string[] | undefined) ?? []).join(" ")}</p>
      )}

      {syncResult && (
        <p className={syncPhase === "success" ? styles.ok : styles.error}>{syncResult}</p>
      )}
      {readBackResult && (
        <p className={readBackPhase === "success" ? styles.ok : styles.error}>{readBackResult}</p>
      )}

      {confirmOp && (
        <div className={styles.confirmOverlay} role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className={styles.confirmBox}>
            <h3 id="confirm-title">Confirm: {confirmOp.label}</h3>
            <p>{confirmOp.description}</p>
            <p className={styles.muted}>
              Type <code>SYNC {projectId.slice(0, 12)}</code> to confirm.
            </p>
            <input
              className={styles.confirmInput}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              aria-label="Confirmation text"
            />
            <div className={styles.buttonRow}>
              <button
                type="button"
                className={`${styles.button} ${styles.buttonPrimary}`}
                onClick={runSync}
                disabled={confirmText !== `SYNC ${projectId.slice(0, 12)}` || syncPhase === "loading"}
              >
                {syncPhase === "loading" ? "Syncing..." : "Confirm and write to staging"}
              </button>
              <button
                type="button"
                className={styles.button}
                onClick={() => {
                  setConfirmOp(null);
                  setConfirmText("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <p className={styles.muted}>
        Need the field definitions? Download the reviewed ACF JSON from the{" "}
        <Link href={`/projects/${projectId}/exports`}>Exports step</Link>.
      </p>
    </section>
  );
}
