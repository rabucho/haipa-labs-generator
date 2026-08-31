"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BrandMediaRecord } from "@/lib/projects/media-repository";

/**
 * Media manager (client): add/inspect/approve/remove project media. Only
 * https remote references or relative local paths are accepted; validation
 * is enforced server-side and surfaced per-field here.
 */
export default function MediaManager({
  projectId,
  initialMedia,
}: {
  projectId: string;
  initialMedia: BrandMediaRecord[];
}) {
  const router = useRouter();
  const [media, setMedia] = useState<BrandMediaRecord[]>(initialMedia);
  const [kind, setKind] = useState<BrandMediaRecord["kind"]>("photo");
  const [name, setName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [altText, setAltText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const res = await fetch(`/api/projects/${projectId}/media`);
    const body = (await res.json()) as {
      ok: boolean;
      media?: BrandMediaRecord[];
    };
    if (body.ok && body.media) setMedia(body.media);
    router.refresh();
  }

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors([]);
    try {
      const res = await fetch(`/api/projects/${projectId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          name,
          ...(sourceUrl ? { sourceUrl } : {}),
          ...(localPath ? { localPath } : {}),
          ...(altText ? { altText } : {}),
        }),
      });
      const body = (await res.json()) as { ok: boolean; errors?: string[] };
      if (!res.ok || !body.ok) {
        setErrors(body.errors ?? ["Adding media failed."]);
        return;
      }
      setName("");
      setSourceUrl("");
      setLocalPath("");
      setAltText("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggleApproved(record: BrandMediaRecord) {
    setBusy(true);
    try {
      await fetch(
        `/api/projects/${projectId}/media?mediaId=${encodeURIComponent(record.id)}&approved=${!record.approved}`,
        { method: "PATCH" }
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(record: BrandMediaRecord) {
    setBusy(true);
    try {
      await fetch(
        `/api/projects/${projectId}/media?mediaId=${encodeURIComponent(record.id)}`,
        { method: "DELETE" }
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <form onSubmit={handleAdd} noValidate>
      <fieldset>
        <legend>Add media reference</legend>
        <div>
          <label htmlFor="kind">Kind</label>
          <select
            id="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as BrandMediaRecord["kind"])}
          >
            <option value="photo">Photo</option>
            <option value="logo">Logo</option>
            <option value="document">Document</option>
            <option value="reference">Reference</option>
          </select>
        </div>
        <div>
          <label htmlFor="name">Name *</label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="sourceUrl">Source URL (https:// only)</label>
          <input
            id="sourceUrl"
            type="url"
            placeholder="https://example.com/photo.jpg"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="localPath">…or local reference path</label>
          <input
            id="localPath"
            placeholder="media/team-photo.jpg"
            value={localPath}
            onChange={(e) => setLocalPath(e.target.value)}
          />
          <small>
            Relative path inside the operator-managed media directory — no
            absolute paths or “..”.
          </small>
        </div>
        <div>
          <label htmlFor="altText">Alt text</label>
          <input
            id="altText"
            value={altText}
            onChange={(e) => setAltText(e.target.value)}
          />
        </div>
        {errors.length > 0 && (
          <ul role="alert">
            {errors.map((error, idx) => (
              <li key={idx}>{error}</li>
            ))}
          </ul>
        )}
        <button type="submit" disabled={busy}>
          {busy ? "Working…" : "Add media"}
        </button>
      </fieldset>
    </form>
  );

  return (
    <div>
      {form}

      <h3>Project media ({media.length})</h3>
      {media.length === 0 ? (
        <p>No media yet for this project.</p>
      ) : (
        <ul>
          {media.map((record) => {
            const previewUrl =
              record.sourceUrl && record.sourceUrl.startsWith("https://")
                ? record.sourceUrl
                : null;
            return (
              <li key={record.id}>
                <div>
                  <strong>{record.name}</strong> — {record.kind} ·{" "}
                  {record.approved ? "approved" : "not approved"}
                </div>
                {previewUrl && record.kind !== "document" && (
                  <img
                    src={previewUrl}
                    alt={record.altText ?? record.name}
                    width={120}
                    height={80}
                    style={{ objectFit: "cover" }}
                  />
                )}
                {record.localPath && <code>{record.localPath}</code>}
                {record.sourceUrl && <code>{record.sourceUrl}</code>}
                <div>
                  <button onClick={() => toggleApproved(record)} disabled={busy}>
                    {record.approved ? "Mark unapproved" : "Mark approved"}
                  </button>{" "}
                  <button onClick={() => remove(record)} disabled={busy}>
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
