import Link from "next/link";
import { templateVersionStore } from "@/lib/templates/version-store";
import DuplicateForm from "./DuplicateForm";
import styles from "./templates.module.css";

export const dynamic = "force-dynamic";

/**
 * /templates — internal template catalog (Slice 15).
 * Catalog actions only; publishing is a catalog action, never a deployment.
 */
export default async function TemplatesCatalogPage() {
  const versions = await templateVersionStore.list();
  const defaultVersionId = await templateVersionStore.getDefaultVersionId();
  const sorted = [...versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <main className={styles.page}>
      <div className="container">
        <span className="eyebrow">Haipa Labs</span>
        <h1 className="section-title">Template catalog</h1>
        <p className={styles.muted}>
          Versions are immutable once published. Editing a published version
          creates a new draft. Setting a default affects{" "}
          <strong>new projects only</strong> — existing projects stay pinned to
          their assigned version.
        </p>

        <form action="/api/templates" method="post" className={styles.actions}>
          <button type="submit" disabled>
            New blank template (coming next)
          </button>
        </form>

        {sorted.length === 0 ? (
          <p className={styles.muted}>
            No template versions yet. Duplicate the built-in template to start.
          </p>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Family</th>
                  <th>Version</th>
                  <th>Status</th>
                  <th>Pages</th>
                  <th>Sections</th>
                  <th>Based on</th>
                  <th>Content hash</th>
                  <th>Default</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((v) => (
                  <tr key={v.versionId}>
                    <td>{v.familyKey}</td>
                    <td>{v.version}</td>
                    <td>{v.status}</td>
                    <td>{v.document.pages.filter((p) => p.enabled).length}</td>
                    <td>{v.document.pages.reduce((n, p) => n + p.sections.length, 0)}</td>
                    <td>{v.basedOnVersionId ?? "—"}</td>
                    <td><code>{v.contentHash}</code></td>
                    <td>{defaultVersionId === v.versionId ? "yes" : "—"}</td>
                    <td>
                      {v.status === "draft" ? (
                        <Link href={`/templates/${v.versionId}`}>Open draft</Link>
                      ) : (
                        <Link href={`/templates/${v.versionId}/preview`}>Preview</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <DuplicateForm
          versions={sorted.map((v) => ({ versionId: v.versionId, familyKey: v.familyKey, version: v.version, status: v.status }))}
        />
      </div>
    </main>
  );
}
