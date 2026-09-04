import { notFound } from "next/navigation";
import Link from "next/link";
import { loadProjectOrNothing } from "@/lib/projects/project-repository";
import { projectDraftRepository } from "@/lib/projects/draft-repository";
import ProjectShell from "@/components/projects/ProjectShell";

export const dynamic = "force-dynamic";

/** Drafts step — all saved drafts for this project, newest first. */
export default async function ProjectDraftsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await loadProjectOrNothing(projectId);
  if (!project) notFound();

  const drafts = await projectDraftRepository.listDrafts(projectId);

  return (
    <ProjectShell project={project} activeStep="review">
      <h2>Drafts</h2>
      {drafts.length === 0 ? (
        <p>No drafts yet.</p>
      ) : (
        <table border={1} cellPadding={8} style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th>Draft</th>
              <th>Source</th>
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
                </td>
                <td>{draft.source}</td>
                <td>{draft.approved ? "yes" : "no"}</td>
                <td>{new Date(draft.updatedAt).toLocaleString()}</td>
                <td>
                  {project.currentDraftId === draft.id && <strong>current </strong>}
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
