import { notFound } from "next/navigation";
import Link from "next/link";
import { loadProjectOrNothing } from "@/lib/projects/project-repository";
import { projectDraftRepository } from "@/lib/projects/draft-repository";
import { generationAuditRepository } from "@/lib/generation/audit";
import { getTemplate, getReadyTemplate } from "@/lib/templates/registry";
import { getAiGenerationConfig } from "@/lib/generation/config";
import ProjectShell from "@/components/projects/ProjectShell";
import ReviewActions from "./ReviewActions";
import { reviewMarkersByPage } from "@/lib/templates/page-inventory";

export const dynamic = "force-dynamic";

/**
 * Review step (Slice 7) — human review workflow for generated drafts.
 * AI output always starts as review; approval is explicit, schema-gated,
 * and audited. Nothing is published or deployed here.
 */
export default async function ProjectReviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await loadProjectOrNothing(projectId);
  if (!project) notFound();

  const drafts = await projectDraftRepository.listDrafts(projectId);
  const template = getTemplate(project.templateId);
  const readyTemplate = getReadyTemplate(project.templateId);
  const audit = await generationAuditRepository.list(projectId);
  const aiEnabled = getAiGenerationConfig().enabled;
  const current = project.currentDraftId
    ? await projectDraftRepository.loadDraft(projectId, project.currentDraftId)
    : null;
  const pageMarkers = current ? reviewMarkersByPage(current.content) : [];
  const forReviewCount = current
    ? [
        current.content.hero.title,
        current.content.hero.body,
        current.content.contact.phone,
        current.content.faqs.items.map((f) => f.answer).join(" "),
      ]
        .join(" ")
        .split("[For review]").length - 1
    : 0;

  return (
    <ProjectShell project={project} activeStep="review">
      <h2>Draft review</h2>
      <p>
        Template: {template?.name ?? project.templateId} · Project status:{" "}
        <strong>{project.status}</strong>. <strong>AI and generated content
        require explicit human approval</strong> — approval records an audit
        event and never publishes to WordPress or deploys anything.
      </p>

      {current && (
        <section>
          <h3>Current draft preview</h3>
          <p>
            <Link href={`/projects/${projectId}/preview`}>
              Open full preview →
            </Link>{" "}
            · Draft <code>{current.id}</code> · source {current.source} ·{" "}
            {forReviewCount > 0
              ? `${forReviewCount} value(s) marked [For review] — missing brief information was NOT invented.`
              : "no [For review] markers found."}
          </p>
          {readyTemplate && (
            <ReviewActions
              projectId={projectId}
              draftId={current.id}
              aiEnabled={aiEnabled}
            />
          )}
          <h4>Section values</h4>
          <ul>
            <li><strong>Home:</strong> {current.content.hero.title}</li>
            <li><strong>About:</strong> {current.content.about.title}</li>
            <li><strong>Services:</strong> {current.content.services.items.length} item(s)</li>
            <li><strong>FAQs:</strong> {current.content.faqs.items.length} item(s)</li>
            <li><strong>Contact:</strong> {current.content.contact.title}</li>
          </ul>
          <h4>[For review] markers by page</h4>
          {pageMarkers.length === 0 ? (
            <p>No missing-information markers — all fields carry real content.</p>
          ) : (
            <ul>
              {pageMarkers.map((m) => (
                <li key={`${m.pageKey}.${m.path}`}>
                  <strong>{m.pageKey}</strong> · <code>{m.path}</code>
                </li>
              ))}
            </ul>
          )}
          <p>
            Page previews:{" "}
            {[
              ["home", "Home"],
              ["about", "About"],
              ["services", "Services"],
              ["faqs", "FAQs"],
              ["contact", "Contact"],
            ].map(([key, label], idx) => (
              <span key={key}>
                {idx > 0 && " · "}
                <Link href={`/projects/${projectId}/preview/${key}`}>{label}</Link>
              </span>
            ))}
          </p>
        </section>
      )}

      <h3>All drafts</h3>
      {drafts.length === 0 ? (
        <p>No drafts yet — generate one from the Generate step.</p>
      ) : (
        <table border={1} cellPadding={8} style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th>Draft</th>
              <th>Source</th>
              <th>Prompt/hash</th>
              <th>Approved</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((draft) => (
              <tr key={draft.id}>
                <td>
                  <code>{draft.id}</code>
                  {project.currentDraftId === draft.id && <strong> · current</strong>}
                </td>
                <td>{draft.source}</td>
                <td>
                  <code>{draft.aiPromptVersion ?? "—"}</code>
                </td>
                <td>{draft.approved ? "yes" : "no"}</td>
                <td>{new Date(draft.updatedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Generation audit (redacted)</h3>
      {audit.length === 0 ? (
        <p>No audit events yet.</p>
      ) : (
        <ul>
          {audit
            .slice()
            .reverse()
            .filter(
              (event, idx, arr) =>
                arr.findIndex((e) => e.id === event.id) === idx
            )
            .slice(0, 8)
            .map((event) => (
              <li key={event.id}>
                {new Date(event.startedAt).toLocaleString()} · {event.status} ·{" "}
                {event.provider} {event.model !== "n/a" ? `(${event.model})` : ""} ·{" "}
                hash <code>{event.inputHash.slice(0, 12)}</code>
                {event.durationMs !== undefined ? ` · ${event.durationMs}ms` : ""}
                {event.operator ? ` · by ${event.operator}` : ""}
              </li>
            ))}
        </ul>
      )}
    </ProjectShell>
  );
}
