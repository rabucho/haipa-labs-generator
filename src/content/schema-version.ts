import type { SchemaVersion } from "@/types/schema";

/**
 * The approved schema/mapping version record for this template.
 *
 * MIGRATION POLICY (Slice 2):
 * Future design changes MUST create a new schema version (schemaVersion + 1)
 * together with an explicit migration plan. Existing customer fields are
 * NEVER silently deleted or renamed:
 *
 *   - Renaming a field requires a new version + a data migration that copies
 *     values from the old wpName to the new one.
 *   - Removing a field requires a deprecation period; data is retained until
 *     the operator explicitly approves deletion.
 *   - Changing a field type requires a migration that converts existing
 *     values or introduces a new field alongside the old one.
 *
 * A future slice will add a machine-readable migration plan format
 * (added/renamed/deprecated/removed per schema version).
 */
export const homeSchemaVersion: SchemaVersion = {
  templateKey: "premium-professional-services-home",
  templateVersion: "1.0.0",
  schemaVersion: 1,
};

/** Human-readable migration note shown on the review page. */
export const migrationNote = [
  "Schema v1 is the initial approved version for this template.",
  "Future design changes must create a new schemaVersion and an explicit migration plan.",
  "Existing customer fields are never silently deleted or renamed; deprecated fields are retired only after operator approval.",
];