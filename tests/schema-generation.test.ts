import { describe, it, expect, vi } from "vitest";
import { contentInventory } from "@/content/content-inventory";
import { homeSchemaVersion } from "@/content/schema-version";
import {
  generateAcfFieldGroup,
  generateFieldMappings,
} from "@/lib/schema/generate";
import type { ContentInventory } from "@/types/inventory";

describe("generateAcfFieldGroup", () => {
  const group = generateAcfFieldGroup(contentInventory, homeSchemaVersion);

  it("includes templateKey, templateVersion, and schemaVersion", () => {
    expect(group.templateKey).toBe(homeSchemaVersion.templateKey);
    expect(group.templateVersion).toBe(homeSchemaVersion.templateVersion);
    expect(group.schemaVersion).toBe(homeSchemaVersion.schemaVersion);
  });

  it("has a unique group key and a front-page location rule", () => {
    expect(group.key).toBe("group_premium-professional-services-home_v1");
    expect(group.title).toContain("premium-professional-services-home");
    expect(group.location).toEqual([
      { param: "page_type", operator: "==", value: "front_page" },
    ]);
  });

  it("excludes design-controlled items from ACF fields", () => {
    const names = group.fields.map((f) => f.name);
    expect(names).not.toContain("n_a");
    expect(names).not.toContain("layout.spacing");
    expect(names).not.toContain("layout.colors");
    expect(names).not.toContain("layout.typography");
    // One ACF field per top-level editable inventory entry (subfields are nested).
    expect(group.fields.length).toBe(topLevelEditableCount());
  });

  it("preserves approved wpName values (stable, never auto-renamed)", () => {
    const names = group.fields.map((f) => f.name);
    expect(names).toContain("hero_title");
    expect(names).toContain("hero_text");
    expect(names).toContain("hero_button_text");
    expect(names).toContain("hero_button_url");
    expect(names).toContain("contact_email");
    expect(names).toContain("footer_copyright");
  });

  it("generates nested repeater definitions for services and faqs", () => {
    const services = group.fields.find((f) => f.name === "services");
    const faqs = group.fields.find((f) => f.name === "faqs");
    expect(services?.type).toBe("repeater");
    expect(services?.subFields?.map((s) => s.name)).toEqual([
      "services_title",
      "services_description",
      "services_url",
    ]);
    expect(faqs?.type).toBe("repeater");
    expect(faqs?.subFields?.map((s) => s.name)).toEqual([
      "faqs_question",
      "faqs_answer",
    ]);
  });

  it("preserves required flags and maxLength values", () => {
    const heroTitle = group.fields.find((f) => f.name === "hero_title");
    expect(heroTitle?.required).toBe(true);
    expect(heroTitle?.maxLength).toBe(120);
    const heroEyebrow = group.fields.find((f) => f.name === "hero_eyebrow");
    expect(heroEyebrow?.required).toBe(false);
  });

  it("sets an explicit return format on image fields", () => {
    const heroImage = group.fields.find((f) => f.name === "hero_image");
    expect(heroImage?.returnFormat).toBe("array");
  });

  it("is deterministic: same input produces identical output", () => {
    const a = generateAcfFieldGroup(contentInventory, homeSchemaVersion);
    const b = generateAcfFieldGroup(contentInventory, homeSchemaVersion);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("rejects duplicate wpName values", () => {
    const bad: ContentInventory[] = [
      ...contentInventory,
      {
        path: "hero.title2",
        label: "Duplicate",
        type: "text",
        editable: true,
        required: true,
        wpName: "hero_title",
        sourceComponent: "Hero.tsx",
        defaultValue: "x",
      },
    ];
    expect(() => generateAcfFieldGroup(bad, homeSchemaVersion)).toThrow(
      /Duplicate wpName/
    );
  });

  it("rejects editable fields without a wpName", () => {
    const bad: ContentInventory[] = [
      {
        path: "hero.title",
        label: "Hero Title",
        type: "text",
        editable: true,
        required: true,
        wpName: "n_a",
        sourceComponent: "Hero.tsx",
        defaultValue: "x",
      },
    ];
    expect(() => generateAcfFieldGroup(bad, homeSchemaVersion)).toThrow(
      /no wpName/
    );
  });

  it("rejects invalid field types", () => {
    const bad = [
      {
        path: "hero.title",
        label: "Hero Title",
        type: "colour" as never,
        editable: true,
        required: true,
        wpName: "hero_title",
        sourceComponent: "Hero.tsx",
        defaultValue: "x",
      },
    ];
    expect(() => generateAcfFieldGroup(bad, homeSchemaVersion)).toThrow();
  });

  it("rejects repeaters without subfields", () => {
    const bad: ContentInventory[] = contentInventory.filter(
      (f) => !f.path.startsWith("services[].") && !f.path.startsWith("faqs[].")
    );
    expect(() => generateAcfFieldGroup(bad, homeSchemaVersion)).toThrow(
      /no subfields|no declared subfields/
    );
  });
});

describe("generateFieldMappings", () => {
  const mappings = generateFieldMappings(contentInventory, homeSchemaVersion);

  it("represents every editable inventory item in the mapping", () => {
    const mappedPaths = new Set(mappings.map((m) => m.internalPath));
    const missing = contentInventory
      .filter((f) => f.editable)
      .map((f) =>
        f.type === "repeater" ? f.path.replace(".items", "[]") : f.path
      )
      .filter((p) => !mappedPaths.has(p));
    expect(missing).toEqual([]);
  });

  it("maps acf.hero_title → hero.title and acf.hero_text → hero.body", () => {
    const byWp = new Map(mappings.map((m) => [m.wpPath, m]));
    expect(byWp.get("acf.hero_title")?.internalPath).toBe("hero.title");
    expect(byWp.get("acf.hero_text")?.internalPath).toBe("hero.body");
  });

  it("maps repeaters as acf.services → services[] with nested subfield paths", () => {
    const services = mappings.find((m) => m.internalPath === "services[]");
    expect(services?.wpPath).toBe("acf.services");
    const sub = mappings.find((m) => m.internalPath === "services[].title");
    expect(sub?.wpPath).toBe("acf.services[].services_title");
    const faqSub = mappings.find((m) => m.internalPath === "faqs[].question");
    expect(faqSub?.wpPath).toBe("acf.faqs[].faqs_question");
  });

  it("preserves wpName values from the approved inventory", () => {
    for (const m of mappings) {
      if (m.type === "repeater") continue;
      const source = contentInventory.find((f) => f.path === m.internalPath);
      expect(m.wpName).toBe(source?.wpName);
    }
  });

  it("preserves required flags and source components", () => {
    const heroTitle = mappings.find((m) => m.internalPath === "hero.title");
    expect(heroTitle?.required).toBe(true);
    expect(heroTitle?.sourceComponent).toBe("Hero.tsx");
  });

  it("excludes design-controlled items from mappings", () => {
    const paths = mappings.map((m) => m.internalPath);
    expect(paths).not.toContain("layout.spacing");
    expect(paths).not.toContain("layout.colors");
    expect(paths).not.toContain("layout.typography");
  });

  it("is deterministic", () => {
    const a = generateFieldMappings(contentInventory, homeSchemaVersion);
    const b = generateFieldMappings(contentInventory, homeSchemaVersion);
    expect(a).toEqual(b);
  });
});

describe("no network access in Slice 2 generators", () => {
  it("generates without any fetch/network activity", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const group = generateAcfFieldGroup(contentInventory, homeSchemaVersion);
    const mappings = generateFieldMappings(contentInventory, homeSchemaVersion);
    expect(group.fields.length).toBeGreaterThan(0);
    expect(mappings.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// Small helper: top-level editable entries (repeaters + scalars, no [] subfields).
function topLevelEditableCount(): number {
  return contentInventory.filter(
    (f) => f.editable && !f.path.includes("[].")
  ).length;
}