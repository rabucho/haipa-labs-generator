import { notFound } from "next/navigation";
import { loadProjectOrNothing } from "@/lib/projects/project-repository";
import { projectDraftRepository } from "@/lib/projects/draft-repository";
import { getReadyTemplate } from "@/lib/templates/registry";
import ProjectShell from "@/components/projects/ProjectShell";

export const dynamic = "force-dynamic";

/**
 * Project preview — renders the project's current draft (falling back to the
 * template's demo content) through the approved HomeTemplate. Both draft and
 * demo content use the same validated HomeContent contract.
 */
export default async function ProjectPreviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await loadProjectOrNothing(projectId);
  if (!project) notFound();

  const template = getReadyTemplate(project.templateId);
  if (!template || !template.render || !template.defaultContent) {
    return (
      <ProjectShell project={project} activeStep="preview">
        <p>Template is not renderable.</p>
      </ProjectShell>
    );
  }

  const currentDraft = project.currentDraftId
    ? await projectDraftRepository.loadDraft(projectId, project.currentDraftId)
    : null;

  const content = currentDraft?.content ?? template.defaultContent;

  return (
    <ProjectShell project={project} activeStep="preview">
      <p>
        {currentDraft ? (
          <>
            Rendering current draft <code>{currentDraft.id}</code> (source:{" "}
            {currentDraft.source}).
          </>
        ) : (
          <>Rendering template demo content — no draft saved yet.</>
        )}
      </p>
      {template.render({ content })}
    </ProjectShell>
  );
}
