"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SECTIONS = ["hero", "about", "services", "faqs", "contact", "footer"] as const;

/**
 * Human-review actions: approve, reject, and AI section regeneration.
 * Approval/rejection are explicit operator actions; section regeneration
 * goes through the server-only AI provider and validates before merging.
 */
export default function ReviewActions({
  projectId,
  draftId,
  aiEnabled,
}: {
  projectId: string;
  draftId: string;
  aiEnabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "approve" | "reject") {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/drafts/${draftId}/${action}`,
        { method: "POST" }
      );
      const body = (await res.json()) as { ok: boolean; errors?: string[] };
      if (!res.ok || !body.ok) {
        setError(body.errors?.[0] ?? `${action} failed.`);
        return;
      }
      setMessage(
        action === "approve"
          ? "Draft approved and recorded in the audit trail. Nothing has been published."
          : "Draft rejected — the previous known-good draft is current again."
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function regenerateSection(section: string) {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/regenerate-section`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId, section }),
      });
      const body = (await res.json()) as { ok: boolean; errors?: string[] };
      if (!res.ok || !body.ok) {
        setError(body.errors?.[0] ?? "Section regeneration failed.");
        return;
      }
      setMessage(`Section "${section}" regenerated as a new draft (status: review).`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button onClick={() => act("approve")} disabled={busy}>
        ✓ Approve draft
      </button>{" "}
      <button onClick={() => act("reject")} disabled={busy}>
        ✕ Reject draft
      </button>{" "}
      <span>Regenerate section (AI{aiEnabled ? "" : " — disabled"}):</span>{" "}
      {SECTIONS.map((section) => (
        <button
          key={section}
          onClick={() => regenerateSection(section)}
          disabled={busy || !aiEnabled}
        >
          {section}
        </button>
      ))}
      {message && <p>{message}</p>}
      {error && <p role="alert">{error}</p>}
      <p>
        <small>
          Approval is temporary and local — it never publishes to WordPress or
          deploys a public site. The operator label “local-operator” is a
          placeholder until real identity exists.
        </small>
      </p>
    </div>
  );
}
