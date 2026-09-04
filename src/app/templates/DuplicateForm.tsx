"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./templates.module.css";

/** Client form: duplicate an existing version as a new immutable draft. */
export default function DuplicateForm({
  versions,
}: {
  versions: Array<{ versionId: string; familyKey: string; version: string; status: string }>;
}) {
  const router = useRouter();
  const [familyKey, setFamilyKey] = useState("professional-services");
  const [basedOn, setBasedOn] = useState(versions[0]?.versionId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        familyKey,
        ...(basedOn ? { basedOnVersionId: basedOn } : {}),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      versionId?: string;
      errors?: string[];
    };
    setBusy(false);
    if (res.ok && json.ok && json.versionId) {
      router.push(`/templates/${json.versionId}`);
    } else {
      setError(json.errors?.join(" ") ?? "Could not create the draft.");
    }
  }

  return (
    <form
      className={styles.actions}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h2 className={styles.subheading}>Duplicate as new draft</h2>
      <label>
        Family key
        <input
          value={familyKey}
          onChange={(e) => setFamilyKey(e.target.value)}
          required
        />
      </label>
      <label>
        Based on version
        <select value={basedOn} onChange={(e) => setBasedOn(e.target.value)}>
          <option value="">(built-in starter)</option>
          {versions.map((v) => (
            <option key={v.versionId} value={v.versionId}>
              {v.familyKey} {v.version} ({v.status})
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create draft"}
      </button>
      {error && (
        <p role="alert" className={styles.errorText}>
          {error}
        </p>
      )}
    </form>
  );
}
