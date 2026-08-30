import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { HomeContentSchema } from "@/types/content";
import { homeFixture } from "@/content/home.fixture";
import { validateHomeContent } from "@/lib/content/validate";
import { mapWordPressHome } from "@/lib/content/wordpress";
import { wordpressSampleResponse } from "@/content/wordpress-sample";
import { contentInventory } from "@/content/content-inventory";
import { HomeTemplate } from "@/components/HomeTemplate";

describe("HomeTemplate rendering", () => {
  it("renders the local fixture through HomeTemplate without throwing", () => {
    const validation = validateHomeContent(homeFixture);
    expect(validation.success).toBe(true);
    // Render smoke test: the template accepts validated fixture data.
    expect(() => HomeTemplate({ content: homeFixture })).not.toThrow();
  });

  it("renders mapped WordPress sample data through HomeTemplate", () => {
    const mapped = mapWordPressHome(wordpressSampleResponse);
    const validation = validateHomeContent(mapped);
    expect(validation.success).toBe(true);
    expect(() => HomeTemplate({ content: mapped })).not.toThrow();
  });
});

describe("ContentInventory completeness", () => {
  // Every intended editable business field in the approved design.
  const intendedEditablePaths = [
    "hero.eyebrow",
    "hero.title",
    "hero.body",
    "hero.primaryCta.label",
    "hero.primaryCta.href",
    "hero.image",
    "about.eyebrow",
    "about.title",
    "about.body",
    "services.eyebrow",
    "services.title",
    "services.items",
    "services[].title",
    "services[].description",
    "services[].href",
    "faqs.eyebrow",
    "faqs.title",
    "faqs.items",
    "faqs[].question",
    "faqs[].answer",
    "contact.title",
    "contact.phone",
    "contact.email",
    "contact.address",
    "footer.copyright",
  ];

  it("lists every intended editable field", () => {
    const paths = new Set(contentInventory.map((f) => f.path));
    const missing = intendedEditablePaths.filter((p) => !paths.has(p));
    expect(missing).toEqual([]);
  });

  it("marks every editable field with a WordPress field name and source component", () => {
    for (const field of contentInventory.filter((f) => f.editable)) {
      expect(field.wpName).toBeTruthy();
      expect(field.wpName).not.toBe("n_a");
      expect(field.sourceComponent).toBeTruthy();
      expect(field.label.length).toBeGreaterThan(0);
    }
  });

  it("includes design-controlled values marked as not editable", () => {
    const designControlled = contentInventory.filter((f) => !f.editable);
    expect(designControlled.length).toBeGreaterThan(0);
    for (const field of designControlled) {
      expect(field.wpName).toBe("n_a");
    }
  });

  it("does not derive inventory from Zod internals (explicit metadata present)", () => {
    for (const field of contentInventory) {
      expect(typeof field.path).toBe("string");
      expect(typeof field.label).toBe("string");
      expect(typeof field.editable).toBe("boolean");
      expect(typeof field.required).toBe("boolean");
      expect(typeof field.wpName).toBe("string");
      expect(typeof field.sourceComponent).toBe("string");
    }
  });
});

describe("raw WordPress type isolation", () => {
  const sectionsDir = join(__dirname, "..", "src", "components");

  function listFilesRecursively(dir: string): string[] {
    const entries = readdirSync(dir);
    return entries.flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return listFilesRecursively(full);
      return [full];
    });
  }

  it("no component file imports raw WordPress response types", () => {
    const offenders: string[] = [];
    for (const file of listFilesRecursively(sectionsDir)) {
      if (!file.endsWith(".tsx") && !file.endsWith(".ts")) continue;
      const source = readFileSync(file, "utf-8");
      if (/@\/types\/wordpress/.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("section components never access raw acf properties", () => {
    const forbidden = /acf\.|hero_title|hero_text|hero_button_|services_title|faqs_question|contact_phone/;
    const offenders = readdirSync(sectionsDir)
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => join(sectionsDir, f))
      .filter((file) => forbidden.test(readFileSync(file, "utf-8")));
    expect(offenders).toEqual([]);
  });
});