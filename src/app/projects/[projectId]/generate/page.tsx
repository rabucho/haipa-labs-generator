import { notFound } from "next/navigation";
import { loadProjectOrNothing } from "@/lib/projects/project-repository";
import { briefRepository } from "@/lib/projects/brief-repository";
import { mediaRepository } from "@/lib/projects/media-repository";
import { getReadyTemplate } from "@/lib/templates/registry";
import {
  getAiGenerationConfig,
  redactedConfigSummary,
} from "@/lib/generation/config";
import {
  listProviderDescriptors,
  listOpenRouterModels,
} from "@/lib/generation/provider-registry";
import ProjectShell from "@/components/projects/ProjectShell";
import GenerateButton from "./GenerateButton";

export const dynamic = "force-dynamic";

/**
 * Generate step — summarizes template/brief/approved media, then generates a
 * draft with the deterministic local provider or (when explicitly enabled via
 * AI_GENERATION_ENABLED) the server-side AI provider. Generated content
 * always requires human review.
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
  const aiConfig = redactedConfigSummary(getAiGenerationConfig());
  // Slice 13 Stage A: safe provider catalog for the selector.
  const providers = listProviderDescriptors();
  const openRouterEnabled = providers.some(
    (p) => p.providerId === "openrouter" && p.availability === "enabled"
  );
  const openRouterModels = openRouterEnabled ? await listOpenRouterModels() : null;

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
        </ul>

        <p>
          AI provider status:{" "}
          {aiConfig.enabled ? (
            <>
              <strong>enabled</strong> — provider {aiConfig.provider}, model{" "}
              {aiConfig.model}
            </>
          ) : (
            <strong>
              disabled (set AI_GENERATION_ENABLED=true and AI_MODEL on the
              server to enable)
            </strong>
          )}
        </p>

        {!brief || !template ? (
          <p>Save a brief (and ensure the template is ready) before generating.</p>
        ) : (
          <GenerateButton
            projectId={projectId}
            aiEnabled={aiConfig.enabled}
            aiModel={aiConfig.model}
            providers={providers}
            openRouterModels={
              openRouterModels && openRouterModels.ok ? openRouterModels.models : null
            }
          />
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
