"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./templates.module.css";

/**
 * Slice 21: create a blank template version (design structure only —
 * never invented client content). Posts the existing validated
 * `{ blank: true, blankInput }` contract from Slice 16.
 */
export default function BlankForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [familyKey, setFamilyKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);

  async function submit() {
    setBusy(true);
    setErrors(null);
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blank: true,
        blankInput: {
          familyKey,
          displayName,
          enabledPages: ["home", "about", "services", "faqs", "contact"],
          designTokens: {},
        },
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
      setErrors(json.errors ?? ["Could not create the blank template."]);
    }
  }

  if (!open) {
    return (
      <button type="button" className={styles.actions} onClick={() => setOpen(true)}>
        New blank template
      </button>
    );
  }

  return (
    <div className={styles.actions}>
      <p className={styles.muted}>
        A blank template is a blank <strong>design structure</strong> using only
        approved sections and tokens — never invented business content.
      </p>
      <label className={styles.muted}>
        Family key (lowercase-hyphen):{" "}
        <input
          value={familyKey}
          onChange={(e) => setFamilyKey(e.target.value)}
          placeholder="hospitality-modern"
          aria-label="Family key"
        />
      </label>{" "}
      <label className={styles.muted}>
        Display name:{" "}
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Hospitality Modern"
          aria-label="Display name"
        />
      </label>
      {errors && (
        <ul role="alert" className={styles.muted}>
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      <div>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !familyKey.trim() || !displayName.trim()}
        >
          {busy ? "Creating…" : "Create blank draft"}
        </button>{" "}
        <button type="button" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
