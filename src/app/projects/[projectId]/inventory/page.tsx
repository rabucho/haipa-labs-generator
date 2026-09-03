import { notFound } from "next/navigation";
import { loadProjectOrNothing } from "@/lib/projects/project-repository";
import { projectDraftRepository } from "@/lib/projects/draft-repository";
import { getReadyTemplate, isReadyTemplate } from "@/lib/templates/registry";
import ProjectShell from "@/components/projects/ProjectShell";

export const dynamic = "force-dynamic";

/**
 * Per-project inventory (Slice 8): the editable-content inventory of the
 * project's template, plus which values in the current draft are marked
 * "[For review]" (missing brief information that was NOT invented).
 */
export default async function ProjectInventoryPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await loadProjectOrNothing(projectId);
  if (!project) notFound();

  const template = getReadyTemplate(project.templateId);
  const inventory = template && isReadyTemplate(template) && template.inventory
    ? template.inventory()
    : [];

  const current = project.currentDraftId
    ? await projectDraftRepository.loadDraft(projectId, project.currentDraftId)
    : null;

  // Collect draft values containing the [For review] marker along paths.
  const reviewMarkers: Array<{ path: string; value: string }> = [];
  if (current) {
    const c = current.content;
    const push = (path: string, value: string | undefined | null) => {
      if (value && value.includes("[For review]")) {
        reviewMarkers.push({ path, value });
      }
    };
    push("hero.eyebrow", c.hero.eyebrow);
    push("hero.title", c.hero.title);
    push("hero.body", c.hero.body);
    push("about.eyebrow", c.about.eyebrow);
    push("about.body", c.about.body);
    push("contact.title", c.contact.title);
    push("contact.phone", c.contact.phone);
    push("contact.address", c.contact.address);
    c.services.items.forEach((s, i) => push(`services[${i}].title`, s.title));
    c.faqs.items.forEach((f, i) => push(`faqs[${i}].answer`, f.answer));
  }

  const editable = inventory.filter((f) => f.editable);
  const designControlled = inventory.filter((f) => !f.editable);

  return (
    <ProjectShell project={project} activeStep="inventory">
      <h2>Editable-content inventory</h2>
      <p>
        Template: <strong>{template?.name ?? project.templateId}</strong> ·{" "}
        {editable.length} editable fields · {designControlled.length}{" "}
        design-controlled values.
      </p>

      {reviewMarkers.length > 0 && (
        <section>
          <h3>Values marked [For review] in the current draft</h3>
          <p>
            These are missing brief facts the generator did NOT invent — fill
            them in the brief or editor before approval.
          </p>
          <ul>
            {reviewMarkers.map((m, idx) => (
              <li key={idx}>
                <code>{m.path}</code>: {m.value}
              </li>
            ))}
          </ul>
        </section>
      )}

      <h3>Editable fields</h3>
      <table border={1} cellPadding={8} style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th>Path</th>
            <th>Label</th>
            <th>Type</th>
            <th>Required</th>
            <th>Max length</th>
            <th>WordPress field</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {editable.map((field) => (
            <tr key={field.path}>
              <td><code>{field.path}</code></td>
              <td>{field.label}</td>
              <td>{field.type}</td>
              <td>{field.required ? "Yes" : "No"}</td>
              <td>{field.maxLength ?? "—"}</td>
              <td><code>{field.wpName}</code></td>
              <td>{field.sourceComponent}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Design-controlled (not editable by clients)</h3>
      <ul>
        {designControlled.map((field) => (
          <li key={field.path}>
            <code>{field.path}</code> — {field.label} (controlled by{" "}
            {field.sourceComponent})
          </li>
        ))}
      </ul>
    </ProjectShell>
  );
}
