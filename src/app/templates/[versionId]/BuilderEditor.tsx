"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { APPROVED_TOKEN_KEYS, type BuilderDocument } from "@/types/builder";
import styles from "../templates.module.css";

/**
 * Constrained builder editor (Slice 15): token colours, page enablement,
 * and section reordering only. No raw HTML/JSX/CSS inputs exist by design.
 */
export default function BuilderEditor({
  versionId,
  initialDocument,
}: {
  versionId: string;
  initialDocument: BuilderDocument;
}) {
  const router = useRouter();
  const [doc, setDoc] = useState<BuilderDocument>(initialDocument);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/templates/${versionId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document: doc }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; errors?: string[] };
    setBusy(false);
    if (res.ok && json.ok) {
      setIsError(false);
      setMsg("Draft saved. Content hash updated.");
      router.refresh();
    } else {
      setIsError(true);
      setMsg(json.errors?.join(" ") ?? "Save failed — the previous document is unchanged.");
    }
  }

  async function act(action: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/templates/${versionId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, confirm: true }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; errors?: string[] };
    setBusy(false);
    if (res.ok && json.ok) {
      setIsError(false);
      setMsg(`Action "${action}" completed.`);
      router.refresh();
    } else {
      setIsError(true);
      setMsg(json.errors?.join(" ") ?? `Action "${action}" failed.`);
    }
  }

  function setToken(key: string, value: string) {
    setDoc((d) => ({ ...d, designTokens: { ...d.designTokens, [key]: value } }));
  }

  function togglePage(pageKey: string) {
    setDoc((d) => ({
      ...d,
      pages: d.pages.map((p) =>
        p.pageKey === pageKey && pageKey !== "home" ? { ...p, enabled: !p.enabled } : p
      ),
    }));
  }

  function moveSection(pageKey: string, instanceId: string, direction: -1 | 1) {
    setDoc((d) => ({
      ...d,
      pages: d.pages.map((p) => {
        if (p.pageKey !== pageKey) return p;
        const sorted = [...p.sections].sort((a, b) => a.order - b.order);
        const idx = sorted.findIndex((s) => s.instanceId === instanceId);
        const swapWith = idx + direction;
        if (swapWith < 0 || swapWith >= sorted.length) return p;
        [sorted[idx], sorted[swapWith]] = [sorted[swapWith], sorted[idx]];
        return { ...p, sections: sorted.map((s, i) => ({ ...s, order: i })) };
      }),
    }));
  }

  const colorKeys = APPROVED_TOKEN_KEYS.filter((k) => k.includes("color"));

  return (
    <BuilderEditorView
      doc={doc}
      colorKeys={colorKeys}
      busy={busy}
      msg={msg}
      isError={isError}
      setToken={setToken}
      togglePage={togglePage}
      moveSection={moveSection}
      save={save}
      act={act}
    />
  );
}

function BuilderEditorView(props: {
  doc: BuilderDocument;
  colorKeys: readonly string[];
  busy: boolean;
  msg: string | null;
  isError: boolean;
  setToken: (key: string, value: string) => void;
  togglePage: (pageKey: string) => void;
  moveSection: (pageKey: string, instanceId: string, direction: -1 | 1) => void;
  save: () => void;
  act: (action: string, confirmText?: string) => void;
}) {
  const { doc, colorKeys, busy, msg, isError, setToken, togglePage, moveSection, save, act } = props;
  return (
    <section>
      <h2 className={styles.subheading}>Design tokens (approved values only)</h2>
      <div className={styles.bindingRow}>
        {colorKeys.map((key) => (
          <label key={key}>
            {key}
            <input
              type="color"
              value={
                (doc.designTokens as Record<string, string | undefined>)[key] ?? "#0f766e"
              }
              onChange={(e) => setToken(key, e.target.value)}
            />
          </label>
        ))}
        <label>
          --button-style
          <select
            value={doc.designTokens["--button-style"] ?? "solid"}
            onChange={(e) => setToken("--button-style", e.target.value)}
          >
            <option value="solid">solid</option>
            <option value="outline">outline</option>
            <option value="pill">pill</option>
          </select>
        </label>
      </div>

      <h2 className={styles.subheading}>Pages & sections</h2>
      {doc.pages.map((page) => (
        <div key={page.pageKey} className={styles.pageCard}>
          <label className={styles.pageToggle}>
            <input
              type="checkbox"
              checked={page.enabled}
              disabled={page.pageKey === "home"}
              onChange={() => togglePage(page.pageKey)}
            />
            <strong>{page.pageKey}</strong>
            {page.pageKey === "home" && " (required)"}
          </label>
          <ol>
            {[...page.sections]
              .sort((a, b) => a.order - b.order)
              .map((s) => (
                <li key={s.instanceId}>
                  {s.sectionType}{" "}
                  <button type="button" onClick={() => moveSection(page.pageKey, s.instanceId, -1)} aria-label={`Move ${s.sectionType} up`}>
                    ↑
                  </button>{" "}
                  <button type="button" onClick={() => moveSection(page.pageKey, s.instanceId, 1)} aria-label={`Move ${s.sectionType} down`}>
                    ↓
                  </button>
                </li>
              ))}
          </ol>
        </div>
      ))}

      <div className={styles.actionRow}>
        <button type="button" onClick={save} disabled={busy}>
          {busy ? "Working…" : "Save draft"}
        </button>
        <button type="button" onClick={() => act("submit-review")} disabled={busy}>
          Submit for review
        </button>
        <button
          type="button"
          onClick={() =>
            act(
              "publish",
              `Publish ${doc.templateVersion}? This adds it to the catalog for new projects. Existing projects stay pinned.`
            )
          }
          disabled={busy}
        >
          Publish
        </button>
        <button
          type="button"
          onClick={() =>
            act(
              "set-default",
              "Set as default for NEW projects only? Existing projects remain pinned to their current template version."
            )
          }
          disabled={busy}
        >
          Set as default (new projects only)
        </button>
      </div>
      {msg && (
        <p className={isError ? styles.errorText : styles.muted} role="status">
          {msg}
        </p>
      )}
    </section>
  );
}
