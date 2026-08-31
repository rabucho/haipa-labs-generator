"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./publication-status.module.css";

/**
 * Rollback button with explicit confirmation. Restores the previous LOCAL
 * published snapshot only — never calls the live WordPress update API.
 */
export default function RollbackButton({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rollback = async () => {
    const confirmed = window.confirm(
      "Rollback the local published snapshot to the previous version? " +
        "This does not modify live WordPress content."
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/editor/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError((body.errors ?? ["Rollback failed."]).join(" "));
      } else {
        setMessage(`Restored published snapshot (${body.hash}).`);
        router.refresh();
      }
    } catch {
      setError("Rollback failed: network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.rollbackBlock}>
      <button
        type="button"
        className={disabled ? styles.buttonDisabled : styles.button}
        disabled={disabled || busy}
        onClick={rollback}
      >
        {busy ? "Rolling back…" : "Rollback to previous published snapshot"}
      </button>
      {message && <p className={styles.ok}>{message}</p>}
      {error && <p className={styles.errorText}>{error}</p>}
    </div>
  );
}
