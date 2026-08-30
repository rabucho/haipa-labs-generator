import type { Metadata } from "next";
import { contentInventory } from "@/content/content-inventory";
import { homeSchemaVersion, migrationNote } from "@/content/schema-version";
import {
  generateAcfFieldGroup,
  generateFieldMappings,
  validateInventory,
} from "@/lib/schema/generate";
import type {
  AcfFieldGroupDefinition,
  FieldMapping,
} from "@/types/schema";
import styles from "./mapping-review.module.css";

export const metadata: Metadata = {
  title: "Mapping Review — Haipa Labs",
  description:
    "Reviewable ACF field-group definition and WordPress-to-React mapping report.",
};

/**
 * /mapping-review — operator review of the generated ACF definition and
 * mapping report. Slice 2 scope: LOCAL REVIEW ONLY. No live WordPress
 * changes have been made; nothing is uploaded or sent anywhere.
 */
export default function MappingReviewPage() {
  const issues = validateInventory(contentInventory);
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  let group: AcfFieldGroupDefinition | null = null;
  let mappings: FieldMapping[] | null = null;
  let generationError: string | null = null;

  try {
    group = generateAcfFieldGroup(contentInventory, homeSchemaVersion);
    mappings = generateFieldMappings(contentInventory, homeSchemaVersion);
  } catch (error) {
    generationError = error instanceof Error ? error.message : String(error);
  }

  const editable = contentInventory.filter((f) => f.editable);
  const designControlled = contentInventory.filter((f) => !f.editable);

  const exportPayload = {
    schemaVersion: group?.schemaVersion ?? homeSchemaVersion.schemaVersion,
    templateKey: group?.templateKey ?? homeSchemaVersion.templateKey,
    templateVersion: group?.templateVersion ?? homeSchemaVersion.templateVersion,
    acfFieldGroup: group,
    fieldMappings: mappings,
    issues,
  };

  const jsonExport = JSON.stringify(exportPayload, null, 2);

  return (
    <main className={styles.page}>
      <div className="container">
        <span className="eyebrow">Haipa Labs Operator Review</span>
        <h1 className="section-title">ACF Mapping Review</h1>

        <div className={styles.metaBar}>
          <span>Template: <strong>{homeSchemaVersion.templateKey}</strong></span>
          <span>Template version: <strong>{homeSchemaVersion.templateVersion}</strong></span>
          <span>Schema version: <strong>{homeSchemaVersion.schemaVersion}</strong></span>
          <span>Editable fields: <strong>{editable.length}</strong></span>
          <span>Design-controlled (excluded from ACF): <strong>{designControlled.length}</strong></span>
        </div>

        <div className={styles.notice}>
          <strong>Review only.</strong> No live WordPress changes have been made.
          This page shows exactly what a future approved import step would create
          and map. Nothing is uploaded or sent to WordPress in this slice.
        </div>

        {errors.length > 0 && (
          <div className={styles.errorBox}>
            <h2 className={styles.subheading}>Errors (generation blocked)</h2>
            <ul>
              {errors.map((issue, idx) => (
                <li key={idx}>
                  <code>{issue.path}</code>: {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {generationError && (
          <div className={styles.errorBox}>
            <h2 className={styles.subheading}>Generation failed</h2>
            <pre className={styles.code}>{generationError}</pre>
          </div>
        )}

        {warnings.length > 0 && (
          <div className={styles.warningBox}>
            <h2 className={styles.subheading}>Warnings</h2>
            <ul>
              {warnings.map((issue, idx) => (
                <li key={idx}>
                  <code>{issue.path}</code>: {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {group && mappings && (
          <>
            <h2 className={styles.subheading}>
              ACF field group: <code>{group.key}</code>
            </h2>
            <p className={styles.muted}>
              Location rule:{" "}
              <code>
                {group.location
                  .map((l) => `${l.param} ${l.operator} ${l.value}`)
                  .join(" && ")}
              </code>{" "}
              · Template: <code>{group.templateKey}</code> v{group.templateVersion} ·
              Schema version: {group.schemaVersion}
            </p>

            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>WordPress field (name)</th>
                    <th>ACF type</th>
                    <th>Required</th>
                    <th>Max length</th>
                    <th>Return format</th>
                    <th>Subfields</th>
                    <th>Label</th>
                  </tr>
                </thead>
                <tbody>
                  {group.fields.map((field) => (
                    <tr key={field.key}>
                      <td className={styles.code}>{field.name}</td>
                      <td>{field.type}</td>
                      <td>{field.required ? "Yes" : "No"}</td>
                      <td>{field.maxLength ?? "—"}</td>
                      <td>{field.returnFormat ?? "—"}</td>
                      <td>
                        {field.subFields ? (
                          <ul className={styles.subfieldList}>
                            {field.subFields.map((sub) => (
                              <li key={sub.key}>
                                <code>{sub.name}</code> ({sub.type}
                                {sub.required ? ", required" : ""}
                                {sub.maxLength ? `, max ${sub.maxLength}` : ""})
                              </li>
                            ))}
                          </ul>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{field.label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h2 className={styles.subheading}>WordPress → React mapping</h2>
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>WordPress path</th>
                    <th>Internal React path</th>
                    <th>Type</th>
                    <th>Required</th>
                    <th>Source component</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((m) => (
                    <tr key={`${m.wpPath}→${m.internalPath}`}>
                      <td className={styles.code}>{m.wpPath}</td>
                      <td className={styles.code}>{m.internalPath}</td>
                      <td>{m.type}</td>
                      <td>{m.required ? "Yes" : "No"}</td>
                      <td>{m.sourceComponent}</td>
                      <td className={styles.muted}>{m.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h2 className={styles.subheading}>Design-controlled (not added to ACF)</h2>
            <ul className={styles.muted}>
              {designControlled.map((f) => (
                <li key={f.path}>
                  <code>{f.path}</code> — {f.label} (controlled by {f.sourceComponent})
                </li>
              ))}
            </ul>

            <h2 className={styles.subheading}>Migration note</h2>
            <ul className={styles.muted}>
              {migrationNote.map((line, idx) => (
                <li key={idx}>{line}</li>
              ))}
            </ul>

            <h2 className={styles.subheading}>Export (copyable JSON)</h2>
            <p className={styles.muted}>
              Copy this JSON for review or future transformation into an ACF
              import format. It is kept local in Slice 2 — nothing is sent to
              WordPress. See <code>exports/README.md</code> for the format.
            </p>
            <pre className={styles.jsonBlock}>{jsonExport}</pre>
          </>
        )}
      </div>
    </main>
  );
}

