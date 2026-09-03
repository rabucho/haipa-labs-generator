import { notFound } from "next/navigation";
import ProjectShell from "@/components/projects/ProjectShell";
import { requireOperatorProjectPage } from "@/lib/auth/guards";
import { getWordPressStagingConfig } from "@/lib/wordpress-staging/provider";
import { syncHistoryRepository } from "@/lib/wordpress-staging/sync-repository";
import { getReadyTemplate } from "@/lib/templates/registry";
import { homeSchemaVersion } from "@/content/schema-version";
import WordPressActions from "./WordPressActions";
import ConnectionCard from "./ConnectionCard";
import styles from "./wordpress.module.css";

/**
 * /projects/[projectId]/wordpress - staging-only WordPress step (Slice 10).
 * Approval and synchronization are separate actions; nothing is published
 * or deployed. Credentials and raw response bodies are never shown.
 */
export default async function ProjectWordPressPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const scoped = await requireOperatorProjectPage(projectId);
  if (!scoped) notFound();
  const { project, repos } = scoped;

  const config = getWordPressStagingConfig();
  const template = getReadyTemplate(project.templateId);
  const drafts = await repos.drafts.listDrafts(projectId);
  const approvedDraft = drafts.find((d) => d.approved) ?? null;
  const history = await syncHistoryRepository.list(projectId);

  return (
    <ProjectShell project={project} activeStep="wordpress">
      <div className={styles.page}>
        <div className={styles.notice} role="note">
          <strong>Staging only.</strong> This step writes structured content to
          the configured staging WordPress site after your explicit
          confirmation. Approval (Review step) and synchronization are separate
          actions. Nothing is published, deployed, or connected to production.
        </div>

        <section className={styles.grid}>
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Connection</h2>
            <dl className={styles.metaList}>
              <div>
                <dt>Status</dt>
                <dd>
                  {config.enabled ? (
                    <span className={styles.ok}>enabled</span>
                  ) : (
                    <span className={styles.warn}>disabled</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Staging target</dt>
                <dd>{config.stagingUrl ? new URL(config.stagingUrl).host : "not configured"}</dd>
              </div>
              <div>
                <dt>Auth mode</dt>
                <dd>{config.authMode ?? "none (public reads)"}</dd>
              </div>
              <div>
                <dt>Credentials</dt>
                <dd>
                  {config.authSecretReference
                    ? "[server-side reference configured]"
                    : "not configured"}
                </dd>
              </div>
            </dl>
          </div>

          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Approved draft</h2>
            <dl className={styles.metaList}>
              <div>
                <dt>Draft</dt>
                <dd>{approvedDraft ? approvedDraft.id : "none approved"}</dd>
              </div>
              <div>
                <dt>Template</dt>
                <dd>
                  {template ? `${template.id} v${template.version}` : project.templateId}
                </dd>
              </div>
              <div>
                <dt>Schema version</dt>
                <dd>{homeSchemaVersion.schemaVersion}</dd>
              </div>
              <div>
                <dt>ACF schema</dt>
                <dd>Reviewed artifact on the Exports step</dd>
              </div>
            </dl>
          </div>
        </section>

        <ConnectionCard
          projectId={project.id}
          initialPageId={project.wordpressConnection?.pageId ?? null}
          initialPageSlug={project.wordpressConnection?.pageSlug ?? null}
          initialVerified={project.wordpressConnection?.pageVerified ?? false}
          integrationEnabled={config.enabled}
          hasApprovedDraft={Boolean(approvedDraft)}
        />

        <WordPressActions
          projectId={project.id}
          projectName={project.name}
          hasApprovedDraft={Boolean(approvedDraft)}
          approvedDraftId={approvedDraft?.id ?? null}
          integrationEnabled={config.enabled}
          stagingHost={config.stagingUrl ? new URL(config.stagingUrl).host : null}
        />

        <section className={styles.historySection}>
          <h2 className={styles.cardTitle}>Sync history</h2>
          {history.length === 0 ? (
            <p className={styles.muted}>No WordPress operations recorded yet.</p>
          ) : (
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Operation</th>
                    <th>Status</th>
                    <th>Draft</th>
                    <th>Read-back</th>
                    <th>Error code</th>
                  </tr>
                </thead>
                <tbody>
                  {[...history].reverse().map((record) => (
                    <tr key={record.id}>
                      <td>{new Date(record.completedAt).toLocaleString()}</td>
                      <td>{record.operation}</td>
                      <td>
                        <span className={record.status === "success" ? styles.ok : styles.warn}>
                          {record.status}
                        </span>
                      </td>
                      <td>{record.draftId ?? "-"}</td>
                      <td>
                        {record.operation === "content-sync" || record.operation === "read-back"
                          ? record.readBackVerified
                            ? "verified"
                            : "not verified"
                          : "-"}
                      </td>
                      <td>{record.errorCode ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className={styles.muted}>
          Connection details shown here are redacted; credentials never leave
          the server. Raw WordPress response bodies are never displayed.
        </p>
      </div>
    </ProjectShell>
  );
}
