"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Saves the template's demo content as the project's first draft (source:
 * "fixture"). Slice A convenience so a new project immediately has previewable
 * content; the AI generation step replaces this in the next slice.
 */
export default function SaveDemoDraftButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      // Fetch the template demo content from the server-side export endpoint.
      const res = await fetch(`/api/projects/${projectId}/demo-draft`, { method: "POST" });
      const body = (await res.json()) as { ok: boolean; errors?: string[] };
      if (!res.ok || !body.ok) {
        setError(body.errors?.[0] ?? "Saving demo draft failed.");
        return;
      }
      router.refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <button onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save template demo draft"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
