import { notFound } from "next/navigation";
import { loadProjectOrNothing } from "@/lib/projects/project-repository";
import { getReadyTemplate, isReadyTemplate } from "@/lib/templates/registry";
import ProjectShell from "@/components/projects/ProjectShell";

export const dynamic = "force-dynamic";

/** Template step — documents the approved design, schema, and inventory. */
export default async function ProjectTemplatePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await loadProjectOrNothing(projectId);
  if (!project) notFound();

  const template = getReadyTemplate(project.templateId);

  return (
    <ProjectShell project={project} activeStep="template">
      {!template ? (
        <p>The project template is not available in the registry.</p>
      ) : (
        <section>
          <h2>{template.name}</h2>
          <p>{template.description}</p>
          <p>
            <strong>Mood:</strong> {template.mood}
          </p>
          <p>
            <strong>Version:</strong> {template.version} · <strong>Category:</strong>{" "}
            {template.category}
          </p>
          {isReadyTemplate(template) && template.inventory && (
            <>
              <h3>Editable-content inventory</h3>
              <p>
                {template.inventory().filter((f) => f.editable).length} editable fields,{" "}
                {template.inventory().filter((f) => !f.editable).length} design-controlled
                values.
              </p>
              <p>
                Required paths: <code>{template.requiredFields.join(", ")}</code>
              </p>
            </>
          )}
        </section>
      )}
    </ProjectShell>
  );
}
