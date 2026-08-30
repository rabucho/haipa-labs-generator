/**
 * Versioned schema/mapping contracts for the design-first generator (Slice 2).
 *
 * These types describe the REVIEWABLE pipeline outputs:
 *   ContentInventory[] → AcfFieldGroupDefinition + FieldMapping[]
 *
 * Nothing in this slice contacts WordPress. The generated definition is a
 * human-reviewable export that a FUTURE slice may transform into ACF JSON/PHP
 * and import after explicit operator approval.
 */

export type SchemaVersion = {
  templateKey: string;
  templateVersion: string;
  schemaVersion: number;
};

export type AcfFieldType =
  | "text"
  | "textarea"
  | "url"
  | "email"
  | "image"
  | "repeater"
  | "group"
  | "post_object";

export type AcfFieldDefinition = {
  key: string;
  name: string;
  label: string;
  type: AcfFieldType;
  required: boolean;
  instructions?: string;
  maxLength?: number;
  returnFormat?: "url" | "array" | "id";
  subFields?: AcfFieldDefinition[];
};

export type AcfLocationRule = {
  param: string;
  operator: string;
  value: string;
};

export type AcfFieldGroupDefinition = {
  key: string;
  title: string;
  location: AcfLocationRule[];
  templateKey: string;
  templateVersion: string;
  schemaVersion: number;
  fields: AcfFieldDefinition[];
};

export type FieldMapping = {
  internalPath: string;
  wpName: string;
  wpPath: string;
  type: string;
  required: boolean;
  sourceComponent: string;
  notes?: string;
};

/** A problem found while validating the inventory before generation. */
export type MappingIssue = {
  severity: "error" | "warning";
  path: string;
  message: string;
};