/**
 * Slice 20 UI patch: WordPressActions diagnostics display + gating.
 * Run once: node scripts/patch-ui.mjs
 */
import { readFileSync, writeFileSync } from "fs";

const file = "src/app/projects/[projectId]/wordpress/WordPressActions.tsx";
let src = readFileSync(file, "utf-8");
let patches = 0;

function replaceOnce(from, to, label) {
  if (!src.includes(from)) {
    console.error("MISS:", label);
    process.exit(1);
  }
  src = src.split(from).join(to);
  patches++;
}

// 1. runDiagnose captures failed diagnostics too
replaceOnce(
  [
    "  async function runDiagnose() {",
    '    setDiagnosePhase("loading");',
    "    setDiagnostics(null);",
    '    const { status, json } = await post("/diagnose");',
    "    if (status === 200 && json.ok) {",
    "      setDiagnostics(json.diagnostics as Record<string, unknown>);",
    '      setDiagnosePhase("success");',
    "    } else {",
    '      setDiagnosePhase("error");',
    "    }",
    "  }",
  ].join("\n"),
  [
    "  async function runDiagnose() {",
    '    setDiagnosePhase("loading");',
    "    setDiagnostics(null);",
    '    const { status, json } = await post("/diagnose");',
    "    const diag = (json.diagnostics ?? null) as Record<string, unknown> | null;",
    "    setDiagnostics(diag);",
    "    setDiagnosePhase(",
    '      status === 200 && json.ok && diag?.ok === true ? "success" : "error"',
    "    );",
    "  }",
  ].join("\n"),
  "runDiagnose"
);

// 2. derived gating flag next to syncReady
replaceOnce(
  "  const syncReady = integrationEnabled && hasApprovedDraft;",
  [
    "  const syncReady = integrationEnabled && hasApprovedDraft;",
    "  // Slice 20: a failed/timeout diagnosis keeps downstream operations locked.",
    "  const diagnosisFailed = diagnostics !== null && diagnostics.ok !== true;",
    "  const gatesLocked = diagnosisFailed;",
  ].join("\n"),
  "gating flag"
);

// 3. disable Dry Run when diagnosis failed
replaceOnce(
  '          onClick={runDryRun}\n          disabled={dryRunPhase === "loading"}',
  [
    "          onClick={runDryRun}",
    '          disabled={dryRunPhase === "loading" || gatesLocked}',
    "          title={gatesLocked ? \"Diagnose the connection successfully first.\" : undefined}",
  ].join("\n"),
  "dry-run gate"
);

// 4. disable Read-back when diagnosis failed
replaceOnce(
  '          onClick={runReadBack}\n          disabled={readBackPhase === "loading" || !integrationEnabled}',
  [
    "          onClick={runReadBack}",
    '          disabled={readBackPhase === "loading" || !integrationEnabled || gatesLocked}',
    "          title={gatesLocked ? \"Diagnose the connection successfully first.\" : undefined}",
  ].join("\n"),
  "read-back gate"
);

// 5. disable Sync when diagnosis failed
replaceOnce(
  "  const syncReady = integrationEnabled && hasApprovedDraft;\n  // Slice 20: a failed/timeout diagnosis keeps downstream operations locked.\n  const diagnosisFailed = diagnostics !== null && diagnostics.ok !== true;\n  const gatesLocked = diagnosisFailed;",
  "  const syncReady = integrationEnabled && hasApprovedDraft && !diagnosisFailed;\n  // Slice 20: a failed/timeout diagnosis keeps downstream operations locked.\n  const diagnosisFailed = diagnostics !== null && diagnostics.ok !== true;\n  const gatesLocked = diagnosisFailed;",
  "sync gate"
);

// 6. rich diagnostics display: phase/errorCode/statusCode/elapsed/remediation
replaceOnce(
  [
    "      {diagnostics && (",
    "        <div className={styles.resultBox}>",
    "          <strong>Diagnosis:</strong> {String(diagnostics.detail)}",
    "          <ul className={styles.metaList}>",
    "            <li>REST reachable: {String(diagnostics.restReachable)}</li>",
    '            <li>Pages readable: {String(diagnostics.pagesReachable)}</li>',
    "            <li>ACF-to-REST detected: {String(diagnostics.acfFieldGroupsReachable)}</li>",
    "            <li>Field-group creation via REST: not supported (use the reviewed export)</li>",
    "          </ul>",
    "        </div>",
    "      )}",
  ].join("\n"),
  [
    "      {diagnostics && (",
    "        <div className={styles.resultBox}>",
    "          <strong>Diagnosis:</strong> {String(diagnostics.detail)}",
    '          {diagnostics.ok !== true && (',
    "            <p className={styles.error}>",
    "              Failed at phase <strong>{String(diagnostics.phase ?? \"unknown\")}</strong>",
    "              {diagnostics.errorCode ? (<> &middot; code <code>{String(diagnostics.errorCode)}</code></>) : null}",
    "              {typeof diagnostics.statusCode === \"number\" ? (<> &middot; HTTP {String(diagnostics.statusCode)}</>) : null}",
    "              {typeof diagnostics.elapsedMs === \"number\" ? (<> &middot; {String(diagnostics.elapsedMs)}ms</>) : null}",
    "              {diagnostics.retryable === true ? \" · retrying the diagnosis is appropriate\" : \" · retrying is unlikely to help until the cause is fixed\"}",
    "            </p>",
    "          )}",
    "          {typeof diagnostics.elapsedMs === \"number\" && diagnostics.ok === true && (",
    "            <p className={styles.muted}>Diagnosis completed in {String(diagnostics.elapsedMs)}ms.</p>",
    "          )}",
    "          {typeof diagnostics.remediation === \"string\" && (",
    "            <p className={styles.warn}>{String(diagnostics.remediation)}</p>",
    "          )}",
    "          <ul className={styles.metaList}>",
    "            <li>REST reachable: {String(diagnostics.restReachable)}</li>",
    '            <li>Pages readable: {String(diagnostics.pagesReachable)}</li>',
    "            <li>ACF-to-REST detected: {String(diagnostics.acfFieldGroupsReachable)}</li>",
    "            <li>Field-group creation via REST: not supported (use the reviewed export)</li>",
    "          </ul>",
    "        </div>",
    "      )}",
  ].join("\n"),
  "diagnostics display"
);

writeFileSync(file, src);
console.log("OK: " + patches + " patches applied");
