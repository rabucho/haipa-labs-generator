import { notFound } from "next/navigation";
import { loadProjectOrNothing } from "@/lib/projects/project-repository";
import { briefRepository } from "@/lib/projects/brief-repository";
import ProjectShell from "@/components/projects/ProjectShell";
import BriefForm from "./BriefForm";

export const dynamic = "force-dynamic";

/** Brief step — validated, project-scoped brand brief form. */
export default async function ProjectBriefPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await loadProjectOrNothing(projectId);
  if (!project) notFound();

  const brief = await briefRepository.loadBrief(projectId);

  return (
    <ProjectShell project={project} activeStep="brief">
      <BriefForm projectId={projectId} initialBrief={brief} />
    </ProjectShell>
  );
}
