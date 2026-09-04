import { notFound } from "next/navigation";
import Link from "next/link";
import { loadProjectOrNothing } from "@/lib/projects/project-repository";
import { projectDraftRepository } from "@/lib/projects/draft-repository";
import ProjectShell from "@/components/projects/ProjectShell";
import SaveDemoDraftButton from "./SaveDemoDraftButton";

export const dynamic = "force-dynamic";

/**
 * Project workspace — the hub for one prospect. Shows current status,
 * current draft, and links into each step of the workflow.
 */
export default async function ProjectWorkspacePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await loadProjectOrNothing(projectId);
  if (!project) notFound();

  const drafts = await projectDraftRepository.listDrafts(projectId);
  const currentDraft = project.currentDraftId
    ? (drafts.find((d) => d.id === project.currentDraftId) ?? null)
    : null;

  return (
    <ProjectShell project={project} activeStep="workspace">
      <section>
        <h2>Workflow status</h2>
        <p>
          {currentDraft ? (
            <>
              Current draft: <code>{currentDraft.id}</code> (source:{" "}
              {currentDraft.source}, {currentDraft.approved ? "approved" : "not approved"},
              updated {new Date(currentDraft.updatedAt).toLocaleString()})
            </>
          ) : (
            "No draft yet — generate or save one to begin visual review."
          )}
        </p>
        <ul>
          <li>
            <Link href={`/projects/${project.id}/template`}>Template</Link> — the approved
            design and its editable-content inventory.
          </li>
          <li>
            <Link href={`/projects/${project.id}/preview`}>Preview</Link> — render the
            current draft (or template demo content) through the approved template.
          </li>
          <li>
            <Link href={`/projects/${project.id}/drafts`}>Drafts</Link> — all saved drafts
            for this project.
          </li>
        </ul>
        <p>
          Brief/media/generate/review/inventory/export steps activate in the next
          internal-factory slices; the navigation above marks their availability.
        </p>
        <SaveDemoDraftButton projectId={project.id} />
      </section>
    </ProjectShell>
  );
}
