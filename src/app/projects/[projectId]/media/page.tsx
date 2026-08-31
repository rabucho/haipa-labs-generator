import { notFound } from "next/navigation";
import { loadProjectOrNothing } from "@/lib/projects/project-repository";
import { mediaRepository } from "@/lib/projects/media-repository";
import ProjectShell from "@/components/projects/ProjectShell";
import MediaManager from "./MediaManager";

export const dynamic = "force-dynamic";

/** Media step — project-scoped brand-media metadata intake and review. */
export default async function ProjectMediaPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await loadProjectOrNothing(projectId);
  if (!project) notFound();

  const media = await mediaRepository.listMedia(projectId);

  return (
    <ProjectShell project={project} activeStep="media">
      <p>
        Media belongs only to this project. This slice stores metadata and safe
        references (https URLs or operator-managed local paths) — the server
        never fetches remote URLs or parses uploaded documents.
      </p>
      <MediaManager projectId={projectId} initialMedia={media} />
    </ProjectShell>
  );
}
