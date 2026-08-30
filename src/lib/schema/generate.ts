import type { ContentInventory } from "@/types/inventory";
import type {
  SchemaVersion,
  AcfFieldGroupDefinition,
  AcfFieldDefinition,
  AcfFieldType,
  FieldMapping,
  MappingIssue,
} from "@/types/schema";

/**
 * Slice 2 pure generators: ContentInventory[] → AcfFieldGroupDefinition +
 * FieldMapping[]. These functions are DETERMINISTIC (same input → same
 * output, no timestamps, no randomness) and perform NO network or WordPress
 * calls. They only validate and transform the approved inventory metadata.
 */

/** Maps an inventory field type to an ACF field type. */
function toAcfType(type: ContentInventory["type"]): AcfFieldType | null {
  switch (type) {
    case "text":
    case "phone":
      return "text";
    case "textarea":
    case "richtext":
      return "textarea";
    case "url":
      return "url";
    case "email":
      return "email";
    case "image":
      return "image";
    case "repeater":
      return "repeater";
    case "postCollection":
      return "post_object";
    default:
      return null;
  }
}

/** Deterministic ACF field key derived from the field name. */
function fieldKey(name: string): string {
  return `field_${name}`;
}

/**
 * Validates the approved inventory before generation.
 * Returns issues; errors block generation, warnings do not.
 */
export function validateInventory(
  inventory: ContentInventory[]
): MappingIssue[] {
  const issues: MappingIssue[] = [];
  const seenWpNames = new Map<string, string>();

  for (const field of inventory) {
    if (!field.editable) continue;

    if (!field.wpName || field.wpName === "n_a") {
      issues.push({
        severity: "error",
        path: field.path,
        message: `Editable field "${field.path}" has no wpName. Every editable field must have an approved WordPress field name.`,
      });
      continue;
    }

    if (toAcfType(field.type) === null) {
      issues.push({
        severity: "error",
        path: field.path,
        message: `Invalid or unsupported field type "${field.type}".`,
      });
    }

    const existing = seenWpNames.get(field.wpName);
    if (existing) {
      issues.push({
        severity: "error",
        path: field.path,
        message: `Duplicate wpName "${field.wpName}" (already used by "${existing}").`,
      });
    } else {
      seenWpNames.set(field.wpName, field.path);
    }
  }

  // Repeater subfield entries must have a declared parent repeater.
  for (const field of inventory) {
    if (!field.editable) continue;
    const bracket = field.path.indexOf("[].");
    if (bracket === -1) continue;
    const rowPrefix = field.path.slice(0, bracket + 2); // "services[]"
    const repeaterPath = `${rowPrefix.replace("[]", "")}.items`; // "services.items"
    const hasParent = inventory.some(
      (f) => f.editable && f.type === "repeater" && f.path === repeaterPath
    );
    if (!hasParent) {
      issues.push({
        severity: "error",
        path: field.path,
        message: `Subfield "${field.path}" has no parent repeater entry "${repeaterPath}" in the inventory.`,
      });
    }
  }

  // Repeaters must have at least one declared subfield.
  for (const field of inventory) {
    if (!field.editable || field.type !== "repeater") continue;
    const rowPrefix = field.path.replace(".items", ""); // "services"
    const hasSubfields = inventory.some((f) =>
      f.path.startsWith(`${rowPrefix}[].`)
    );
    if (!hasSubfields) {
      issues.push({
        severity: "error",
        path: field.path,
        message: `Repeater "${field.path}" has no declared subfields (expected entries like "${rowPrefix}[].title").`,
      });
    }
  }

  return issues;
}

/**
 * Builds the ACF field tree from the approved inventory.
 *
 * Deterministic: preserves the manually approved wpName from the inventory
 * (existing fields are never renamed automatically). Repeaters collect their
 * `[]` subfield entries into nested subFields, in inventory order.
 */
export function generateAcfFieldGroup(
  inventory: ContentInventory[],
  version: SchemaVersion
): AcfFieldGroupDefinition {
  const issues = validateInventory(inventory);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length > 0) {
    throw new Error(
      "Cannot generate ACF field group: inventory validation failed.\n" +
        errors.map((e) => `  [${e.path}] ${e.message}`).join("\n")
    );
  }

  const fields: AcfFieldDefinition[] = [];
  const consumed = new Set<string>();

  for (const field of inventory) {
    if (!field.editable || consumed.has(field.path)) continue;

    if (field.type === "repeater") {
      const rowPrefix = field.path.replace(".items", ""); // "services"
      const subEntries = inventory.filter(
        (f) => f.editable && f.path.startsWith(`${rowPrefix}[].`)
      );

      if (subEntries.length === 0) {
        throw new Error(
          `Repeater "${field.path}" has no subfields. Declare entries like "${rowPrefix}[].title" in the inventory.`
        );
      }

      const subFields: AcfFieldDefinition[] = subEntries.map((sub) => {
        const subAcf = toAcfType(sub.type);
        if (subAcf === null) {
          throw new Error(
            `Invalid field type "${sub.type}" for repeater subfield "${sub.path}".`
          );
        }
        const def: AcfFieldDefinition = {
          key: fieldKey(sub.wpName),
          name: sub.wpName,
          label: sub.label,
          type: subAcf,
          required: sub.required,
          ...(sub.maxLength !== undefined ? { maxLength: sub.maxLength } : {}),
        };
        consumed.add(sub.path);
        return def;
      });

      fields.push({
        key: fieldKey(field.wpName),
        name: field.wpName,
        label: field.label,
        type: "repeater",
        required: field.required,
        ...(field.notes ? { instructions: field.notes } : {}),
        subFields,
      });
      consumed.add(field.path);
      continue;
    }

    const acfType = toAcfType(field.type);
    if (acfType === null) {
      throw new Error(`Invalid field type "${field.type}" for "${field.path}".`);
    }

    const def: AcfFieldDefinition = {
      key: fieldKey(field.wpName),
      name: field.wpName,
      label: field.label,
      type: acfType,
      required: field.required,
      ...(field.notes ? { instructions: field.notes } : {}),
      ...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {}),
      ...(field.type === "image" ? { returnFormat: "array" as const } : {}),
    };
    fields.push(def);
    consumed.add(field.path);
  }

  return {
    key: `group_${version.templateKey}_v${version.schemaVersion}`,
    title: `${version.templateKey} — schema v${version.schemaVersion}`,
    location: [{ param: "page_type", operator: "==", value: "front_page" }],
    templateKey: version.templateKey,
    templateVersion: version.templateVersion,
    schemaVersion: version.schemaVersion,
    fields,
  };
}

/**
 * Pure mapping generator: internal React paths → WordPress ACF paths.
 * Example outputs:
 *   acf.hero_title                → hero.title
 *   acf.services                  → services[]
 *   acf.services[].services_title → services[].title
 */
export function generateFieldMappings(
  inventory: ContentInventory[],
  version: SchemaVersion
): FieldMapping[] {
  if (!version.templateKey || version.schemaVersion < 1) {
    throw new Error(
      `Invalid schema version record: templateKey "${version.templateKey}", schemaVersion ${version.schemaVersion}.`
    );
  }

  const issues = validateInventory(inventory);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length > 0) {
    throw new Error(
      `Cannot generate field mappings: ${errors.length} inventory error(s). First: [${errors[0].path}] ${errors[0].message}`
    );
  }

  const mappings: FieldMapping[] = [];
  const consumed = new Set<string>();

  for (const field of inventory) {
    if (!field.editable || consumed.has(field.path)) continue;

    if (field.type === "repeater") {
      const rowPrefix = field.path.replace(".items", ""); // "services"
      mappings.push({
        internalPath: `${rowPrefix}[]`,
        wpName: field.wpName,
        wpPath: `acf.${field.wpName}`,
        type: "repeater",
        required: field.required,
        sourceComponent: field.sourceComponent,
        ...(field.notes ? { notes: field.notes } : {}),
      });

      for (const sub of inventory) {
        if (!sub.editable || !sub.path.startsWith(`${rowPrefix}[].`)) continue;
        const subInternal = sub.path; // e.g. "services[].title"
        mappings.push({
          internalPath: subInternal,
          wpName: sub.wpName,
          wpPath: `acf.${field.wpName}[].${sub.wpName}`,
          type: sub.type,
          required: sub.required,
          sourceComponent: sub.sourceComponent,
          ...(sub.notes ? { notes: sub.notes } : {}),
        });
      }
      consumed.add(field.path);
      continue;
    }

    mappings.push({
      internalPath: field.path,
      wpName: field.wpName,
      wpPath: `acf.${field.wpName}`,
      type: field.type,
      required: field.required,
      sourceComponent: field.sourceComponent,
      ...(field.notes ? { notes: field.notes } : {}),
    });
  }

  return mappings;
}