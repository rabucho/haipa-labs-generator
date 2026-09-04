import Link from "next/link";
import { templateVersionStore } from "@/lib/templates/version-store";
import { projectRepository } from "@/lib/projects/project-repository";
import DuplicateForm from "./DuplicateForm";
import ImportForm from "./ImportForm";
import BlankForm from "./BlankForm";
import styles from "./templates.module.css";

export const dynamic = "force-dynamic";

/**
 * /templates — internal template catalog (Slices 15 + 21).
 * Catalog actions only; publishing is a catalog action, never a deployment.
 * Project counts show which versions are pinned (safe metadata only).
 */
export default async function TemplatesCatalogPage() {
  const versions = await templateVersionStore.list();
  const defaultVersionId = await templateVersionStore.getDefaultVersionId();
  const sorted = [...versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const projects = await projectRepository.listProjects();
  const usageByVersion = new Map<string, number>();
  for (const p of projects) {
    if (!p.templateVersionId) continue;
    usageByVersion.set(
      p.templateVersionId,
      (usageByVersion.get(p.templateVersionId) ?? 0) + 1
    );
  }

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

        <BlankForm />
        <ImportForm />

        {sorted.length === 0 ? (
          <p className={styles.muted}>
            No template versions yet. Duplicate the built-in template, create a
            blank one, or import a package to start.
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
                  <th>Projects pinned</th>
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
                      {usageByVersion.get(v.versionId) ?? 0}
                      {(usageByVersion.get(v.versionId) ?? 0) > 0 && (
                        <span className={styles.muted}>
                          {" "}· <Link href={`/api/templates/${v.versionId}/usage`}>usage</Link>
                        </span>
                      )}
                    </td>
                    <td>
                      {v.status === "draft" ? (
                        <Link href={`/templates/${v.versionId}`}>Open draft</Link>
                      ) : v.status === "published" || v.status === "archived" ? (
                        <>
                          <Link href={`/templates/${v.versionId}/preview`}>Preview</Link>
                          {" · "}
                          <Link href={`/templates/${v.versionId}/preview`}>Compare</Link>
                          <span className={styles.muted}>
                            {" "}· {v.status === "published" ? "immutable — duplicate to edit" : "archived"}
                          </span>
                        </>
                      ) : (
                        <Link href={`/templates/${v.versionId}`}>Open (review)</Link>
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
