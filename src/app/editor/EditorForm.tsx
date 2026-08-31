"use client";

import React, { useState } from "react";
import type {
  DesignControlledItem,
  EditorField,
  EditorSection,
} from "@/lib/editor/fields";
import type { HomeContent } from "@/types/content";
import styles from "./editor.module.css";

type EditorFormProps = {
  initialContent: HomeContent;
  sections: EditorSection[];
  designControlled: DesignControlledItem[];
  publishedContent: HomeContent | null;
  initialSavedAt: string | null;
  initialHash: string | null;
  initialPublishedHash: string | null;
  initialPublishedAt: string | null;
};

/** Immutable deep set along a dotted path with numeric array segments. */
function setByPath(obj: unknown, segments: string[], value: unknown): unknown {
  if (segments.length === 0) return value;
  const clone: Record<string, unknown> = Array.isArray(obj)
    ? ([...(obj as unknown[])] as unknown as Record<string, unknown>)
    : { ...(obj as Record<string, unknown>) };
  const [head, ...rest] = segments;
  clone[head] = setByPath(clone[head], rest, value);
  return clone;
}

function getByPath(obj: unknown, segments: string[]): unknown {
  return segments.reduce<unknown>(
    (acc, seg) =>
      acc !== null && typeof acc === "object"
        ? (acc as Record<string, unknown>)[seg]
        : undefined,
    obj
  );
}

function segmentsFor(fieldPath: string, rowIndex?: number): string[] {
  if (rowIndex === undefined) return fieldPath.split(".");
  // "services[].title" → ["services", "items", "<rowIndex>", "title"]
  const [head, sub] = fieldPath.replace("[]", "").split(".");
  return [head, "items", String(rowIndex), sub];
}

export default function EditorForm(props: EditorFormProps) {
  const { sections, designControlled, publishedContent } = props;
  const [content, setContent] = useState<HomeContent>(props.initialContent);
  const [savedJson, setSavedJson] = useState<string>(
    JSON.stringify(props.initialContent)
  );
  const [savedAt, setSavedAt] = useState<string | null>(props.initialSavedAt);
  const [draftHash, setDraftHash] = useState<string | null>(props.initialHash);
  const [publishedHash, setPublishedHash] = useState<string | null>(
    props.initialPublishedHash
  );
  const [publishedAt, setPublishedAt] = useState<string | null>(
    props.initialPublishedAt
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "save" | "publish">("");

  const currentJson = JSON.stringify(content);
  const dirty = currentJson !== savedJson;

  const update = (path: string, rowIndex: number | undefined, value: unknown) => {
    setContent((prev) => setByPath(prev, segmentsFor(path, rowIndex), value) as HomeContent);
  };

  const publishedValueAt = (field: EditorField, rowIndex?: number): string => {
    if (!publishedContent) return "—";
    const value = getByPath(publishedContent, segmentsFor(field.path, rowIndex));
    if (value === undefined || value === null) return "—";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  const saveDraft = async () => {
    setBusy("save");
    setErrors([]);
    setMessage(null);
    try {
      const res = await fetch("/api/editor/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: currentJson,
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setErrors(body.errors ?? ["Saving the draft failed."]);
      } else {
        setSavedJson(currentJson);
        setSavedAt(body.savedAt);
        setDraftHash(body.hash);
        setMessage(`Draft saved (${body.hash}).`);
      }
    } catch {
      setErrors(["Saving the draft failed: network error."]);
    } finally {
      setBusy("");
    }
  };

  const publishDraft = async () => {
    setBusy("publish");
    setErrors([]);
    setMessage(null);
    try {
      const res = await fetch("/api/editor/publish", { method: "POST" });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setErrors(body.errors ?? ["Publishing the draft failed."]);
      } else {
        setPublishedHash(body.hash);
        setPublishedAt(body.publishedAt);
        setMessage(
          `Draft published to the local snapshot (${body.hash}) at ${new Date(body.publishedAt).toLocaleString()}.`
        );
      }
    } catch {
      setErrors(["Publishing the draft failed: network error."]);
    } finally {
      setBusy("");
    }
  };

  const addRow = (itemsPath: string) => {
    const head = itemsPath.replace(".items", "");
    const rows = (getByPath(content, [head, "items"]) as unknown[]) ?? [];
    const templateRow = rows[0] as Record<string, unknown> | undefined;
    const newRow: Record<string, unknown> = templateRow
      ? JSON.parse(JSON.stringify(templateRow))
      : {};
    newRow.id = `${head === "services" ? "local_srv" : "local_faq"}_${Math.random().toString(36).slice(2, 10)}`;
    for (const key of Object.keys(newRow)) {
      if (key !== "id") newRow[key] = "";
    }
    setContent(
      (prev) => setByPath(prev, [head, "items"], [...rows, newRow]) as HomeContent
    );
  };

  const removeRow = (itemsPath: string, index: number) => {
    const head = itemsPath.replace(".items", "");
    setContent((prev) => {
      const rows = [...((getByPath(prev, [head, "items"]) as unknown[]) ?? [])];
      rows.splice(index, 1);
      return setByPath(prev, [head, "items"], rows) as HomeContent;
    });
  };

  const setImage = (fieldPath: string, part: "url" | "alt", val: string) => {
    const current = getByPath(content, fieldPath.split(".")) as
      | { url?: string; alt?: string }
      | null;
    const next = {
      url: part === "url" ? val : current?.url ?? "",
      alt: part === "alt" ? val : current?.alt ?? "",
    };
    update(fieldPath, undefined, next.url.trim() === "" ? null : next);
  };

  const renderField = (field: EditorField, rowIndex?: number) => {
    const value = getByPath(content, segmentsFor(field.path, rowIndex));
    const publishedVal = publishedValueAt(field, rowIndex);
    const key = `${field.path}#${rowIndex ?? "top"}`;
    return (
      <div key={key} className={styles.field}>
        <label className={styles.label}>
          {field.label}{" "}
          {field.required && <span className={styles.required}>*</span>}
          <code className={styles.wpName}>{field.wpName}</code>
        </label>
        {field.type === "textarea" ? (
          <textarea
            className={styles.input}
            rows={3}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => update(field.path, rowIndex, e.target.value)}
          />
        ) : field.type === "image" ? (
          <div className={styles.imageFields}>
            <input
              className={styles.input}
              placeholder="Image URL"
              value={(value as { url?: string } | null)?.url ?? ""}
              onChange={(e) => setImage(field.path, "url", e.target.value)}
            />
            <input
              className={styles.input}
              placeholder="Alt text"
              value={(value as { alt?: string } | null)?.alt ?? ""}
              onChange={(e) => setImage(field.path, "alt", e.target.value)}
            />
          </div>
        ) : (
          <input
            className={styles.input}
            type={field.type === "email" ? "email" : field.type === "url" ? "url" : "text"}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => update(field.path, rowIndex, e.target.value)}
          />
        )}
        {field.maxLength !== undefined && (
          <span className={styles.hint}>Max {field.maxLength} characters.</span>
        )}
        <span className={styles.publishedValue}>
          Published value: {publishedVal}
        </span>
      </div>
    );
  };

  return (
    <div className={styles.editor}>
      <div className={styles.statusBar}>
        <span className={dirty ? styles.dirty : styles.clean}>
          {dirty ? "● Unsaved changes" : "✓ All changes saved"}
        </span>
        <span>Last saved: {savedAt ? new Date(savedAt).toLocaleString() : "never"}</span>
        <span>
          Last published: {publishedAt ? new Date(publishedAt).toLocaleString() : "never"}
        </span>
        <span>Draft hash: <code>{draftHash ?? "—"}</code></span>
        <span>Published hash: <code>{publishedHash ?? "—"}</code></span>
        <div className={styles.actions}>
          <button type="button" className={styles.primaryButton} disabled={!dirty || busy !== ""} onClick={saveDraft}>
            {busy === "save" ? "Saving…" : "Save draft"}
          </button>
          <button type="button" className={styles.button} disabled={dirty || busy !== "" || !savedAt} onClick={publishDraft}>
            {busy === "publish" ? "Publishing…" : "Publish draft → local snapshot"}
          </button>
        </div>
      </div>

      {errors.length > 0 && (
        <div className={styles.errorBox}>
          <strong>Draft rejected:</strong>
          <ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      {message && <div className={styles.okBox}>{message}</div>}

      {sections.map((section) => (
        <section key={section.key} className={styles.section}>
          <h2 className={styles.sectionTitle}>{section.title}</h2>
          {section.fields.map((field) => renderField(field))}
          {section.repeater && (
            <div className={styles.repeater}>
              <div className={styles.repeaterHeader}>
                <h3 className={styles.repeaterTitle}>Rows ({section.repeater.wpName})</h3>
                <button type="button" className={styles.button} onClick={() => addRow(section.repeater!.itemsPath)}>
                  Add row
                </button>
              </div>
              {((getByPath(content, section.repeater.itemsPath.split(".")) as Array<Record<string, unknown>>) ?? []).map((row, idx) => (
                <div key={String(row.id ?? idx)} className={styles.repeaterRow}>
                  <div className={styles.rowHeader}>
                    <code className={styles.wpName}>Stable row id: {String(row.id ?? `index ${idx}`)}</code>
                    <button type="button" className={styles.removeButton} onClick={() => removeRow(section.repeater!.itemsPath, idx)}>
                      Remove row
                    </button>
                  </div>
                  {section.repeater!.fields.map((f) => renderField(f, idx))}
                </div>
              ))}
            </div>
          )}
        </section>
      ))}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Design-controlled (locked in the approved template)</h2>
        <ul className={styles.designControlled}>
          {designControlled.map((item) => (
            <li key={item.path}>
              <code>{item.path}</code> — {item.label} (controlled by {item.sourceComponent})
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

