"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./templates.module.css";

/**
 * Slice 21: import a structured template package (JSON).
 * Client-side preview shows the server's validation summary (errors and
 * warnings) BEFORE anything is saved; the server re-validates everything.
 */
export default function ImportForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function readFile(file: File) {
    // Read locally in the browser; only JSON text is sent to the server.
    if (file.size > 256 * 1024) {
      setErrors(["File exceeds the 256 KB import limit."]);
      return;
    }
    setText(await file.text());
    setFileName(file.name);
    setErrors(null);
    setWarnings(null);
    setSuccess(null);
  }

  async function submit() {
    setBusy(true);
    setErrors(null);
    setWarnings(null);
    setSuccess(null);
    const res = await fetch("/api/templates/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageJson: text, provenance: { source: "external-import", ...(fileName ? { label: fileName } : {}) } }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      versionId?: string;
      version?: string;
      errors?: string[];
      warnings?: string[];
    };
    setBusy(false);
    if (res.ok && json.ok && json.versionId) {
      setWarnings(json.warnings ?? []);
      setSuccess(`Imported as draft ${json.version ?? ""}. Opening the editor…`);
      setTimeout(() => router.push(`/templates/${json.versionId}`), 900);
    } else {
      setErrors(json.errors ?? ["Import failed safely. Nothing was persisted."]);
    }
  }

  if (!open) {
    return (
      <button type="button" className={styles.actions} onClick={() => setOpen(true)}>
        Import template package (JSON)
      </button>
    );
  }

  return (
    <div className={styles.actions}>
      <label className={styles.muted}>
        Template package file (.json, max 256 KB):{" "}
        <input
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void readFile(file);
          }}
        />
      </label>
      <textarea
        aria-label="Template package JSON"
        rows={10}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste the template package JSON here, or choose a file above."
        style={{ width: "100%", fontFamily: "monospace", fontSize: "0.8125rem" }}
      />
      <p className={styles.muted}>
        The package is validated with strict schemas before anything is saved.
        Code, JSX/HTML, scripts, unknown sections, and unapproved tokens are
        rejected. Imports always create a NEW draft version — published or
        existing versions are never overwritten.
      </p>
      {errors && (
        <ul className={styles.muted} role="alert">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      {warnings && warnings.length > 0 && (
        <ul className={styles.muted}>
          {warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}
      {success && <p className={styles.muted}>{success}</p>}
      <div>
        <button type="button" onClick={submit} disabled={busy || !text.trim()}>
          {busy ? "Validating…" : "Validate & import as draft"}
        </button>{" "}
        <button type="button" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
