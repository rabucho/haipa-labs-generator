import type { ContentInventory } from "@/types/inventory";

/**
 * Builds editor form descriptors from the approved ContentInventory.
 * Pure and client-safe (no server-only imports, no Zod internals):
 * the editor form is generated from the explicit inventory metadata only.
 */

export type EditorFieldType = "text" | "textarea" | "url" | "email" | "image";

export type EditorField = {
  /** Concrete value path within HomeContent, e.g. "hero.title". */
  path: string;
  label: string;
  /** Stable WordPress field name (never renamed automatically). */
  wpName: string;
  type: EditorFieldType;
  required: boolean;
  maxLength?: number;
  notes?: string;
  section: string;
  /** For repeater subfields: the row template path, e.g. "services[]". */
  rowTemplate?: string;
};

export type EditorRepeater = {
  /** Array path in HomeContent, e.g. "services.items". */
  itemsPath: string;
  wpName: string;
  rowLabel: string;
  fields: EditorField[];
};

export type EditorSection = {
  key: string;
  title: string;
  fields: EditorField[];
  repeater?: EditorRepeater;
};

export type DesignControlledItem = {
  path: string;
  label: string;
  sourceComponent: string;
  notes?: string;
};

const TYPE_MAP: Record<string, EditorFieldType> = {
  text: "text",
  phone: "text",
  textarea: "textarea",
  richtext: "textarea",
  url: "url",
  email: "email",
  image: "image",
};

const SECTION_TITLES: Record<string, string> = {
  hero: "Hero",
  about: "About",
  services: "Services",
  faqs: "FAQs",
  contact: "Contact",
  footer: "Footer",
};

function toEditorType(type: string): EditorFieldType | null {
  return TYPE_MAP[type] ?? null;
}

/**
 * Groups the approved inventory into editor sections. Editable repeater
 * subfields become rows inside their section's repeater; design-controlled
 * entries are returned separately and are never editable.
 */
export function buildEditorSections(inventory: ContentInventory[]): {
  sections: EditorSection[];
  designControlled: DesignControlledItem[];
} {
  const sections = new Map<string, EditorSection>();
  const designControlled: DesignControlledItem[] = [];

  const sectionFor = (key: string): EditorSection => {
    let section = sections.get(key);
    if (!section) {
      section = {
        key,
        title: SECTION_TITLES[key] ?? key,
        fields: [],
      };
      sections.set(key, section);
    }
    return section;
  };

  for (const item of inventory) {
    if (!item.editable) {
      designControlled.push({
        path: item.path,
        label: item.label,
        sourceComponent: item.sourceComponent,
        ...(item.notes ? { notes: item.notes } : {}),
      });
      continue;
    }

    const sectionKey = item.path.split(/[.[]/)[0];
    const section = sectionFor(sectionKey);

    // Repeater parents are handled before the type guard: "repeater" is not
    // an editor input type, it declares a row collection for the section.
    if (item.type === "repeater") {
      const rowPrefix = item.path.replace(".items", "[]"); // "services[]"
      section.repeater = {
        itemsPath: item.path,
        wpName: item.wpName,
        rowLabel: rowPrefix,
        fields: [],
      };
      continue;
    }

    const editorType = toEditorType(item.type);
    if (!editorType) continue; // unsupported inventory type for the editor

    const isSubfield = item.path.includes("[].");
    const field: EditorField = {
      path: item.path,
      label: item.label,
      wpName: item.wpName,
      type: editorType,
      required: item.required,
      ...(item.maxLength !== undefined ? { maxLength: item.maxLength } : {}),
      ...(item.notes ? { notes: item.notes } : {}),
      section: sectionKey,
    };

    if (isSubfield) {
      const rowTemplate = item.path.split("[].")[0] + "[]";
      field.rowTemplate = rowTemplate;
      const parentPath = rowTemplate.replace("[]", "") + ".items";
      const section2 = sections.get(sectionKey);
      if (section2?.repeater && section2.repeater.itemsPath === parentPath) {
        section2.repeater.fields.push(field);
      }
      continue;
    }

    section.fields.push(field);
  }

  return { sections: [...sections.values()], designControlled };
}

/** Flat list of editable field descriptors (for tests and simple UIs). */
export function buildEditorFields(inventory: ContentInventory[]): EditorField[] {
  const { sections } = buildEditorSections(inventory);
  return sections.flatMap((s) => [
    ...s.fields,
    ...(s.repeater?.fields ?? []),
  ]);
}
