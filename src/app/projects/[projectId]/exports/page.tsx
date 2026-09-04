import { notFound } from "next/navigation";
import { loadProjectOrNothing } from "@/lib/projects/project-repository";
import { projectDraftRepository } from "@/lib/projects/draft-repository";
import { getReadyTemplate } from "@/lib/templates/registry";
import {
  generateAcfFieldGroup,
  generateFieldMappings,
} from "@/lib/schema/generate";
import { contentInventory } from "@/content/content-inventory";
import ProjectShell from "@/components/projects/ProjectShell";

export const dynamic = "force-dynamic";

/**
 * Per-project exports (Slice 8): reviewable ACF field-group definition,
 * WordPress→React mapping report, and the current draft content JSON —
 * generated locally with the existing pure generators. Downloadable via
 * /api/projects/<id>/export?kind=… Nothing is sent to WordPress.
 */
export default async function ProjectExportsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await loadProjectOrNothing(projectId);
  if (!project) notFound();

  const template = getReadyTemplate(project.templateId);
  const version = {
    templateKey: project.templateId,
    templateVersion: template?.version ?? "0.0.0",
    schemaVersion: 1,
  };
  const group = generateAcfFieldGroup(contentInventory, version);
  const mappings = generateFieldMappings(contentInventory, version);
  const current = project.currentDraftId
    ? await projectDraftRepository.loadDraft(projectId, project.currentDraftId)
    : null;

  const downloads: Array<{ kind: string; label: string; description: string }> = [
    { kind: "acf", label: "ACF field group", description: `${group.fields.length} top-level fields (incl. repeater subfields) — schema v${group.schemaVersion}` },
    { kind: "mappings", label: "Field mappings", description: `${mappings.length} WordPress→React mappings` },
    { kind: "full", label: "Full export", description: "ACF group + mappings + version + template info" },
    {
      kind: "content",
      label: "Current draft content",
      description: current
        ? `Draft ${current.id} (source: ${current.source})`
        : "No current draft yet",
    },
  ];

  return (
    <ProjectShell project={project} activeStep="exports">
      <h2>Exports</h2>
      <p>
        Generated locally and offline from the approved inventory and this
        project&apos;s template (v{version.templateVersion}, schema v
        {version.schemaVersion}). Review-only — <strong>nothing is sent to
        WordPress</strong>; the future import step requires explicit operator
        approval.
      </p>

      <table border={1} cellPadding={8} style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th>Artifact</th>
            <th>Contents</th>
            <th>Download</th>
          </tr>
        </thead>
        <tbody>
          {downloads.map((d) => (
            <tr key={d.kind}>
              <td><strong>{d.label}</strong></td>
              <td>{d.description}</td>
              <td>
                {d.kind === "content" && !current ? (
                  "—"
                ) : (
                  <a href={`/api/projects/${projectId}/export?kind=${d.kind}`}>
                    Download JSON
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>ACF field group preview</h3>
      <pre
        style={{
          background: "var(--color-secondary)",
          color: "var(--color-text-light)",
          padding: "1rem",
          borderRadius: 8,
          overflowX: "auto",
          maxHeight: 360,
          fontSize: "0.75rem",
        }}
      >
        {JSON.stringify(group, null, 2)}
      </pre>
    </ProjectShell>
  );
}
