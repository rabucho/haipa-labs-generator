import type {
  AcfFieldDefinition,
  AcfFieldGroupDefinition,
} from "@/types/schema";

/**
 * Slice 3: transforms the reviewable internal AcfFieldGroupDefinition into
 * ACF's NATIVE JSON import format (Advanced Custom Fields → Tools → Import,
 * or acf_add_local_field_group() via local JSON).
 *
 * This transformer is a pure function with no network access and no WordPress
 * calls. Import itself remains a HUMAN-REVIEWED step on the staging site —
 * nothing is created automatically.
 *
 * NOTE: the exact native shape has been matched to ACF 6.x local field group
 * JSON (key/name/label/type/required 0|1/maxlength as string/return_format/
 * show_in_rest/sub_fields). Verify against the staging ACF version during the
 * manual import checklist (docs/wordpress-staging-setup.md).
 */

export type AcfNativeField = {
  key: string;
  label: string;
  name: string;
  type: string;
  required: 0 | 1;
  instructions?: string;
  maxlength?: string;
  return_format?: "url" | "array" | "id";
  show_in_rest: 1;
  layout?: "table" | "block" | "row";
  button_label?: string;
  sub_fields?: AcfNativeField[];
};

export type AcfNativeFieldGroup = {
  key: string;
  title: string;
  active: true;
  location: Array<Array<{ param: string; operator: string; value: string }>>;
  show_in_rest: 1;
  fields: AcfNativeField[];
};

function toNativeField(field: AcfFieldDefinition): AcfNativeField {
  const native: AcfNativeField = {
    key: field.key,
    label: field.label,
    name: field.name,
    type: field.type,
    required: field.required ? 1 : 0,
    show_in_rest: 1,
    ...(field.instructions ? { instructions: field.instructions } : {}),
    ...(field.maxLength !== undefined ? { maxlength: String(field.maxLength) } : {}),
    ...(field.returnFormat ? { return_format: field.returnFormat } : {}),
  };

  if (field.type === "repeater" && field.subFields) {
    return {
      ...native,
      layout: "block",
      button_label: `Add ${field.label}`,
      sub_fields: field.subFields.map(toNativeField),
    };
  }

  return native;
}

/** Converts one internal group definition to ACF native local-JSON shape. */
export function toAcfNativeGroup(
  group: AcfFieldGroupDefinition
): AcfNativeFieldGroup {
  return {
    key: group.key,
    title: group.title,
    active: true,
    location: [group.location.map((rule) => ({ ...rule }))],
    show_in_rest: 1,
    fields: group.fields.map(toNativeField),
  };
}

/**
 * Produces the file-shaped payload ACF's JSON import accepts: an array of
 * field groups. Write this to exports/acf-import.acf.json for the operator.
 */
export function toAcfImportFile(
  group: AcfFieldGroupDefinition
): AcfNativeFieldGroup[] {
  return [toAcfNativeGroup(group)];
}
