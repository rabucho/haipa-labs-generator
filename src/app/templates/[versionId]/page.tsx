import { notFound } from "next/navigation";
import Link from "next/link";
import { templateVersionStore } from "@/lib/templates/version-store";
import { validateBuilderDocument, diffBuilderDocuments } from "@/types/builder";
import BuilderEditor from "./BuilderEditor";
import styles from "../templates.module.css";

export const dynamic = "force-dynamic";

/**
 * /templates/[versionId] — constrained builder editor for DRAFT versions.
 * Published versions are immutable (view + semantic diff only).
 */
export default async function TemplateVersionPage({
  params,
}: {
  params: Promise<{ versionId: string }>;
}) {
  const { versionId } = await params;
  const version = await templateVersionStore.get(versionId);
  if (!version) notFound();

  const basedOn = version.basedOnVersionId
    ? await templateVersionStore.get(version.basedOnVersionId)
    : null;
  const diff = basedOn ? diffBuilderDocuments(basedOn.document, version.document) : null;
  const issues = validateBuilderDocument(version.document);
  const isDraft = version.status === "draft";

  return (
    <main className={styles.page}>
      <div className="container">
        <Link href="/templates">← Template catalog</Link>
        <h1 className="section-title">
          {version.familyKey} v{version.version}{" "}
          <span className={styles.muted}>({version.status})</span>
        </h1>
        <p className={styles.muted}>
          Content hash <code>{version.contentHash}</code>
          {basedOn && (
            <>
              {" "}· based on <code>{basedOn.versionId}</code>
            </>
          )}
          . Design-controlled settings only — client content is supplied later
          through brief/AI/WordPress, never through this editor.
        </p>

        {issues.length > 0 && (
          <div className={styles.errorBox}>
            <strong>Validation:</strong>
            <ul>
              {issues.map((i, idx) => (
                <li key={idx}>
                  <code>{i.path}</code>: {i.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {diff && (
          <section>
            <h2 className={styles.subheading}>Changes vs source version</h2>
            <ul>
              {diff.tokensChanged.map((t) => (
                <li key={t.key}>
                  Token {t.key}: {t.from} → {t.to}
                </li>
              ))}
              {diff.sectionsReordered.map((s, i) => (
                <li key={`${s.pageKey}.${s.sectionType}.${i}`}>
                  {s.pageKey}: {s.sectionType} moved {s.from} → {s.to}
                </li>
              ))}
              {diff.sectionsAdded.map((s, i) => (
                <li key={`a${i}`}>
                  {s.pageKey}: + {s.sectionType}
                </li>
              ))}
              {diff.sectionsRemoved.map((s, i) => (
                <li key={`r${i}`}>
                  {s.pageKey}: − {s.sectionType}
                </li>
              ))}
              {diff.pagesDisabled.length > 0 && <li>Disabled pages: {diff.pagesDisabled.join(", ")}</li>}
              {diff.shellChanged && <li>Header/footer configuration changed.</li>}
              <li>Projects affected: <strong>{diff.projectsAffected}</strong> (pinned versions never change).</li>
            </ul>
          </section>
        )}

        {isDraft ? (
          <BuilderEditor versionId={version.versionId} initialDocument={version.document} />
        ) : (
          <p className={styles.muted}>
            This version is <strong>{version.status}</strong> and immutable.
            {version.status === "published" && " Duplicate it from the catalog to make changes."}
          </p>
        )}

        <p>
          <Link href={`/templates/${version.versionId}/preview`}>Open full preview →</Link>
        </p>
      </div>
    </main>
  );
}
