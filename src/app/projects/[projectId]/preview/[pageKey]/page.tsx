import { notFound } from "next/navigation";
import { loadProjectOrNothing } from "@/lib/projects/project-repository";
import { projectDraftRepository } from "@/lib/projects/draft-repository";
import { getReadyTemplate } from "@/lib/templates/registry";
import { renderProjectPage } from "@/lib/templates/pages";
import { isPageKey } from "@/types/pages";
import ProjectShell from "@/components/projects/ProjectShell";

export const dynamic = "force-dynamic";

/**
 * Page-aware project preview (Slice 12): /projects/[id]/preview/[pageKey]
 * renders one enabled page of the project's current draft (or template demo
 * content) through the shared site shell and approved section components.
 * Disabled pages (Shop without WooCommerce) resolve to 404.
 */
export default async function ProjectPagePreview({
  params,
}: {
  params: Promise<{ projectId: string; pageKey: string }>;
}) {
  const { projectId, pageKey } = await params;
  const project = await loadProjectOrNothing(projectId);
  if (!project) notFound();
  if (!isPageKey(pageKey)) notFound();

  const template = getReadyTemplate(project.templateId);
  if (!template || !template.defaultContent) {
    return (
      <ProjectShell project={project} activeStep="preview">
        <p>Template is not renderable.</p>
      </ProjectShell>
    );
  }

  const currentDraft = project.currentDraftId
    ? await projectDraftRepository.loadDraft(projectId, project.currentDraftId)
    : null;

  const home = currentDraft?.content ?? template.defaultContent;
  const rendered = renderProjectPage({
    content: {
      templateKey: template.id,
      templateVersion: template.version,
      schemaVersion: "2.0",
      pages: {
        home,
        about: home.about,
        services: home.services,
        faqs: home.faqs,
        contact: home.contact,
      },
    },
    pageKey,
    brandName: project.name,
  });

  if (!rendered) notFound();

  return (
    <ProjectShell project={project} activeStep="preview">
      <p>
        {currentDraft ? (
          <>
            Rendering page <code>{pageKey}</code> of draft{" "}
            <code>{currentDraft.id}</code>.
          </>
        ) : (
          <>
            Rendering page <code>{pageKey}</code> from template demo content —
            no draft saved yet.
          </>
        )}
      </p>
      {rendered}
    </ProjectShell>
  );
}
