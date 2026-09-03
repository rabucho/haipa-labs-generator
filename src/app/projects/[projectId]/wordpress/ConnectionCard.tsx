"use client";

import { useState } from "react";
import styles from "./wordpress.module.css";

/**
 * Slice 11 connection card: bind the project to a staging page, verify the
 * binding, and run the read-only draft-versus-staging diff. The browser only
 * ever sends the page id/slug — the target origin and credentials are
 * resolved and validated server-side.
 */

type Phase = "idle" | "loading" | "success" | "error";

type DiffRow = { path: string; label: string; draft: string; staging: string };
type DiffItem = { id: string; field: string; draft: string | null; staging: string | null };

type DiffPayload = {
  unchanged: boolean;
  text: DiffRow[];
  links: DiffRow[];
  images: DiffRow[];
  services: { added: string[]; removed: string[]; changed: DiffItem[] };
  faqs: { added: string[]; removed: string[]; changed: DiffItem[] };
};

export default function ConnectionCard({
  projectId,
  initialPageId,
  initialPageSlug,
  initialVerified,
  integrationEnabled,
  hasApprovedDraft,
}: {
  projectId: string;
  initialPageId: number | null;
  initialPageSlug: string | null;
  initialVerified: boolean;
  integrationEnabled: boolean;
  hasApprovedDraft: boolean;
}) {
  const [pageId, setPageId] = useState(initialPageId?.toString() ?? "");
  const [pageSlug, setPageSlug] = useState(initialPageSlug ?? "");
  const [savePhase, setSavePhase] = useState<Phase>("idle");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [verified, setVerified] = useState(initialVerified);
  const [verifyPhase, setVerifyPhase] = useState<Phase>("idle");
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [diffPhase, setDiffPhase] = useState<Phase>("idle");
  const [diff, setDiff] = useState<DiffPayload | null>(null);
  const [diffMsg, setDiffMsg] = useState<string | null>(null);

  const base = `/api/projects/${projectId}/wordpress`;

  async function saveBinding() {
    setSavePhase("loading");
    setSaveMsg(null);
    const body: Record<string, unknown> = { targetKey: "staging" };
    if (pageId.trim()) body.pageId = Number.parseInt(pageId.trim(), 10);
    if (pageSlug.trim()) body.pageSlug = pageSlug.trim().toLowerCase();
    const res = await fetch(`${base}/connection`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; errors?: string[] };
    if (res.ok && json.ok) {
      setSavePhase("success");
      setSaveMsg("Binding saved. Run Verify page to confirm it on staging.");
      setVerified(false);
    } else {
      setSavePhase("error");
      setSaveMsg(json.errors?.join(" ") ?? "Could not save the binding.");
    }
  }

  async function verifyPage() {
    setVerifyPhase("loading");
    setVerifyMsg(null);
    const res = await fetch(`${base}/verify-page`, { method: "POST" });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; errors?: string[] };
    if (res.ok && json.ok) {
      setVerifyPhase("success");
      setVerified(true);
      setVerifyMsg("Page found on the staging origin and verified.");
    } else {
      setVerifyPhase("error");
      setVerified(false);
      setVerifyMsg(json.errors?.join(" ") ?? "Verification failed.");
    }
  }

  async function runDiff() {
    setDiffPhase("loading");
    setDiffMsg(null);
    setDiff(null);
    const res = await fetch(`${base}/diff`, { method: "POST" });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      diff?: DiffPayload;
      errors?: string[];
    };
    if (res.ok && json.ok && json.diff) {
      setDiffPhase("success");
      setDiff(json.diff);
    } else {
      setDiffPhase("error");
      setDiffMsg(json.errors?.join(" ") ?? "Diff failed.");
    }
  }

  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>Staging page binding</h2>
      <p className={styles.muted}>
        Bind this project to one page on the allowlisted staging origin. The
        target and credentials are validated server-side; the browser never
        chooses the destination.
      </p>
      <div className={styles.bindingRow}>
        <label>
          Page ID
          <input
            type="text"
            inputMode="numeric"
            value={pageId}
            onChange={(e) => setPageId(e.target.value)}
            placeholder="e.g. 6"
          />
        </label>
        <label>
          Page slug
          <input
            type="text"
            value={pageSlug}
            onChange={(e) => setPageSlug(e.target.value)}
            placeholder="e.g. home"
          />
        </label>
      </div>
      <div className={styles.actionRow}>
        <button type="button" onClick={saveBinding} disabled={savePhase === "loading"}>
          {savePhase === "loading" ? "Saving…" : "Save binding"}
        </button>
        <button
          type="button"
          onClick={verifyPage}
          disabled={verifyPhase === "loading" || !integrationEnabled}
        >
          {verifyPhase === "loading" ? "Verifying…" : "Verify page"}
        </button>
        <button
          type="button"
          onClick={runDiff}
          disabled={diffPhase === "loading" || !hasApprovedDraft}
          title={hasApprovedDraft ? undefined : "Requires an approved draft"}
        >
          {diffPhase === "loading" ? "Comparing…" : "Draft vs staging diff"}
        </button>
        <span className={verified ? styles.ok : styles.warn}>
          {verified ? "page verified" : "not verified"}
        </span>
      </div>
      {!integrationEnabled && (
        <p className={styles.muted}>
          The staging integration is disabled on the server. Enable
          WORDPRESS_INTEGRATION_ENABLED and set WORDPRESS_STAGING_URL to use
          these actions.
        </p>
      )}
      {saveMsg && (
        <p className={savePhase === "error" ? styles.errorText : styles.muted} role="status">
          {saveMsg}
        </p>
      )}
      {verifyMsg && (
        <p className={verifyPhase === "error" ? styles.errorText : styles.muted} role="status">
          {verifyMsg}
        </p>
      )}
      {diffMsg && (
        <p className={styles.errorText} role="alert">
          {diffMsg}
        </p>
      )}
      {diff && <DiffView diff={diff} />}
    </section>
  );
}

function DiffRowList({ title, rows }: { title: string; rows: DiffRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h3>{title}</h3>
      <ul>
        {rows.map((c) => (
          <li key={`${title}.${c.path}`}>
            <strong>{c.label}</strong> ({c.path}): staging “{c.staging}” ← draft “{c.draft}”
          </li>
        ))}
      </ul>
    </div>
  );
}

function RepeaterDiff({ title, data }: { title: string; data: { added: string[]; removed: string[]; changed: DiffItem[] } }) {
  if (data.added.length === 0 && data.removed.length === 0 && data.changed.length === 0) {
    return null;
  }
  return (
    <div>
      <h3>{title}</h3>
      <ul>
        {data.added.map((id) => (
          <li key={`add-${id}`}>added on staging: {id}</li>
        ))}
        {data.removed.map((id) => (
          <li key={`rem-${id}`}>missing on staging: {id}</li>
        ))}
        {data.changed.map((c) => (
          <li key={`${c.id}.${c.field}`}>
            {c.id}.{c.field}: staging “{c.staging}” ← draft “{c.draft}”
          </li>
        ))}
      </ul>
    </div>
  );
}

function DiffView({ diff }: { diff: DiffPayload }) {
  if (diff.unchanged) {
    return <p className={styles.ok}>Staging content matches the approved draft exactly.</p>;
  }
  return (
    <div className={styles.diffBlock}>
      <DiffRowList title="Text changes" rows={diff.text} />
      <DiffRowList title="Link changes" rows={diff.links} />
      <DiffRowList title="Image changes" rows={diff.images} />
      <RepeaterDiff title="Services (by stable id)" data={diff.services} />
      <RepeaterDiff title="FAQs (by stable id)" data={diff.faqs} />
      <p className={styles.muted}>
        Unmapped WordPress fields and unrelated pages are never touched.
        Design-controlled values are excluded from this comparison.
      </p>
    </div>
  );
}
