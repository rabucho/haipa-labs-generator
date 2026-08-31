import { notFound } from "next/navigation";
import Link from "next/link";
import { loadProjectOrNothing } from "@/lib/projects/project-repository";
import { projectDraftRepository } from "@/lib/projects/draft-repository";
import { getTemplate } from "@/lib/templates/registry";
import ProjectShell from "@/components/projects/ProjectShell";

export const dynamic = "force-dynamic";

/**
 * Review step (Slice 6) — lists the project's drafts. The current draft is
 * always the one generated/saved last (pointer on the project record). Every
 * draft — generated or manual — requires explicit human review; nothing is
 * auto-approved and no WordPress update endpoint is ever called.
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

  return (
    <ProjectShell project={project} activeStep="review">
      <h2>Draft review</h2>
      <p>
        Template: {template?.name ?? project.templateId} · Current status:{" "}
        <strong>{project.status}</strong>. Generated content requires human
        review before any approval.
      </p>
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
              <th></th>
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
                <td>
                  <Link href={`/projects/${project.id}/preview`}>preview</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ProjectShell>
  );
}
