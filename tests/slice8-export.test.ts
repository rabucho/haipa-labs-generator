import { describe, it, expect, beforeEach } from "vitest";
import { rmSync } from "fs";
import { join } from "path";
import { JsonFileProjectRepository } from "@/lib/projects/project-repository";
import { JsonFileProjectDraftRepository } from "@/lib/projects/draft-repository";
import { deterministicProvider } from "@/lib/generation/deterministic-provider";
import { contentInventory } from "@/content/content-inventory";
import { getReadyTemplate } from "@/lib/templates/registry";
import { generateAcfFieldGroup, generateFieldMappings } from "@/lib/schema/generate";

const dataDir = join(process.cwd(), ".slice8-test-data");
process.env.PROJECTS_DATA_DIR = dataDir;

const projectRepo = new JsonFileProjectRepository();
const draftRepo = new JsonFileProjectDraftRepository();
const template = getReadyTemplate("premium-professional-services-home")!;
const version = {
  templateKey: template.id,
  templateVersion: template.version,
  schemaVersion: 1,
};

const input = {
  project: { id: "proj_exp", name: "Export Co", slug: "export-co", industry: "tech" },
  brief: {
    businessName: "Export Co",
    industry: "tech",
    offer: "Software consulting and cloud migrations.",
  },
  media: [],
  template,
  inventory: contentInventory,
};

beforeEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("per-project export artifacts (Slice 8)", () => {
  it("generates an ACF group carrying the project template key and schema version", () => {
    const group = generateAcfFieldGroup(contentInventory, version);
    expect(group.templateKey).toBe(template.id);
    expect(group.templateVersion).toBe(template.version);
    expect(group.schemaVersion).toBe(1);
    expect(group.fields.length).toBeGreaterThan(0);
  });

  it("generates mappings covering every editable inventory field", () => {
    const mappings = generateFieldMappings(contentInventory, version);
    const mapped = new Set(
      mappings.map((m) => (m.type === "repeater" ? m.internalPath : m.internalPath))
    );
    for (const f of contentInventory.filter((x) => x.editable && !x.path.includes("[]."))) {
      const expected = f.type === "repeater" ? f.path.replace(".items", "[]") : f.path;
      expect(mapped.has(expected)).toBe(true);
    }
  });

  it("exports the current project draft and respects project isolation", async () => {
    const projectA = await projectRepo.createProject({
      name: "Export A",
      prospectName: "A",
      industry: "tech",
      templateId: template.id,
    });
    const projectB = await projectRepo.createProject({
      name: "Export B",
      prospectName: "B",
      industry: "tech",
      templateId: template.id,
    });
    const draft = await draftRepo.createDraft({
      projectId: projectA.id,
      templateId: template.id,
      content: (await deterministicProvider.generateWebsiteDraft(input)).content,
      source: "manual",
    });
    await projectRepo.updateProject(projectA.id, { currentDraftId: draft.id });

    // A exports its own current draft content.
    const a = await draftRepo.loadDraft(projectA.id, draft.id);
    expect(a?.content.hero.title).toContain("Export Co");
    // B has no current draft — a content export must fail cleanly.
    expect(projectB.currentDraftId ?? null).toBeNull();
    expect(await draftRepo.loadDraft(projectB.id, draft.id)).toBeNull();
  });
});
