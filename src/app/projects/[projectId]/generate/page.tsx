import { notFound } from "next/navigation";
import { loadProjectOrNothing } from "@/lib/projects/project-repository";
import { briefRepository } from "@/lib/projects/brief-repository";
import { mediaRepository } from "@/lib/projects/media-repository";
import { getReadyTemplate } from "@/lib/templates/registry";
import ProjectShell from "@/components/projects/ProjectShell";
import GenerateButton from "./GenerateButton";

export const dynamic = "force-dynamic";

/**
 * Generate step — summarizes template/brief/approved media, runs the
 * deterministic local provider, and links to the draft preview. Generated
 * content always requires human review.
 */
export default async function ProjectGeneratePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await loadProjectOrNothing(projectId);
  if (!project) notFound();

  const template = getReadyTemplate(project.templateId);
  const brief = await briefRepository.loadBrief(projectId);
  const media = await mediaRepository.listMedia(projectId);
  const approvedMedia = media.filter((m) => m.approved);

  return (
    <ProjectShell project={project} activeStep="generate">
      <section>
        <h2>Generation summary</h2>
        <ul>
          <li>
            Template: <strong>{template?.name ?? project.templateId}</strong> (v
            {template?.version ?? "?"})
          </li>
          <li>
            Brief:{" "}
            {brief ? (
              <>
                saved — {brief.businessName} ({brief.industry})
              </>
            ) : (
              <strong>not saved yet — save the brief first</strong>
            )}
          </li>
          <li>
            Approved media: {approvedMedia.length} of {media.length} item(s)
          </li>
          <li>Provider: deterministic-local (promptVersion deterministic-v1)</li>
        </ul>

        {!brief || !template ? (
          <p>Save a brief (and ensure the template is ready) before generating.</p>
        ) : (
          <GenerateButton projectId={projectId} />
        )}

        <p>
          <strong>Generated content requires human review.</strong> It is never
          auto-approved, and no WordPress update endpoint is called by
          generation.
        </p>
      </section>
    </ProjectShell>
  );
}
