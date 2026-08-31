import { describe, it, expect, vi, beforeEach } from "vitest";
import { rmSync } from "fs";
import { join } from "path";
import { BrandBriefSchema } from "@/lib/projects/brief-repository";
import {
  BrandMediaInputSchema,
  JsonFileMediaRepository,
} from "@/lib/projects/media-repository";
import { JsonFileProjectRepository } from "@/lib/projects/project-repository";
import { JsonFileProjectDraftRepository } from "@/lib/projects/draft-repository";
import {
  DeterministicLocalProvider,
  canonicalize,
  computeInputHash,
} from "@/lib/generation/deterministic-provider";
import { contentInventory } from "@/content/content-inventory";
import { getReadyTemplate } from "@/lib/templates/registry";
import { HomeTemplate } from "@/components/HomeTemplate";
import { isActivePath, projectIdFromPath } from "@/components/app/AppSidebar";

const dataDir = join(process.cwd(), ".slice6-test-data");
process.env.PROJECTS_DATA_DIR = dataDir;

const projectRepo = new JsonFileProjectRepository();
const briefStore = new (await import("@/lib/projects/brief-repository"))
  .JsonFileBriefRepository();
const mediaRepo = new JsonFileMediaRepository();
const draftRepo = new JsonFileProjectDraftRepository();
const provider = new DeterministicLocalProvider();
const template = getReadyTemplate("premium-professional-services-home")!;

const briefA = {
  businessName: "Amani Solar Ltd",
  industry: "renewable energy",
  offer:
    "Installation and maintenance of commercial solar systems. Energy audits for factories.",
  location: "Nairobi",
  audience: "Facilities managers of mid-size factories",
  tone: "Calm, plain-spoken, technical",
  contactDetails: { phone: "+254 700 111 222", email: "hello@amanisolar.co.ke" },
};

const briefB = {
  businessName: "Kilima Lodge",
  industry: "hospitality",
  offer: "Boutique safari lodging with guided nature walks and farm dining.",
  location: "Naivasha",
};

function makeInput(brief: typeof briefA | typeof briefB) {
  return {
    project: {
      id: "proj_test",
      name: brief.businessName,
      slug: "test",
      industry: brief.industry,
    },
    brief,
    media: [
      {
        id: "media_1",
        kind: "photo" as const,
        name: "Hero photo",
        sourceUrl: "https://images.example.com/hero.jpg",
        altText: "Approved hero photo",
        approved: true,
      },
      {
        id: "media_2",
        kind: "photo" as const,
        name: "Unapproved photo",
        sourceUrl: "https://images.example.com/other.jpg",
        approved: false,
      },
    ],
    template,
    inventory: contentInventory,
  };
}

describe("brief validation and isolation", () => {
  it("accepts a valid brief and rejects missing required fields", () => {
    expect(BrandBriefSchema.safeParse(briefA).success).toBe(true);
    for (const key of ["businessName", "industry", "offer"] as const) {
      expect(
        BrandBriefSchema.safeParse({ ...briefA, [key]: undefined }).success
      ).toBe(false);
    }
  });

  it("persists and loads the brief for the same project", async () => {
    const project = await createProject("Brief Persist");
    await briefStore.saveBrief(project.id, BrandBriefSchema.parse(briefA));
    const loaded = await briefStore.loadBrief(project.id);
    expect(loaded?.businessName).toBe("Amani Solar Ltd");
  });

  it("project A cannot load or overwrite project B's brief", async () => {
    const projectA = await createProject("Iso A");
    const projectB = await createProject("Iso B");
    await briefStore.saveBrief(projectA.id, BrandBriefSchema.parse(briefA));
    await briefStore.saveBrief(projectB.id, BrandBriefSchema.parse(briefB));

    const fromA = await briefStore.loadBrief(projectA.id);
    expect(fromA?.businessName).toBe("Amani Solar Ltd");

    await briefStore.saveBrief(projectA.id, BrandBriefSchema.parse(briefB));
    expect((await briefStore.loadBrief(projectB.id))?.businessName).toBe(
      "Kilima Lodge"
    );
  });
});

describe("brand media validation and isolation", () => {
  it("persists media per project, unapproved by default", async () => {
    const project = await createProject("Media Persist");
    await mediaRepo.addMedia(project.id, {
      kind: "photo",
      name: "Team photo",
      sourceUrl: "https://images.example.com/team.jpg",
      altText: "The team",
    });
    const media = await mediaRepo.listMedia(project.id);
    expect(media).toHaveLength(1);
    expect(media[0].approved).toBe(false);
  });

  it("rejects unsafe URLs and unsafe local paths", () => {
    const cases = [
      { kind: "photo", name: "x", sourceUrl: "http://insecure.example.com/a.jpg" },
      { kind: "photo", name: "x", sourceUrl: "javascript:alert(1)" },
      { kind: "document", name: "x", localPath: "../../etc/passwd" },
      { kind: "document", name: "x", localPath: "C:\\Users\\secret.docx" },
      { kind: "photo", name: "x" }, // no reference at all
    ];
    for (const c of cases) {
      expect(BrandMediaInputSchema.safeParse(c).success).toBe(false);
    }
  });

  it("project A cannot list project B's media", async () => {
    const projectA = await createProject("Media Iso A");
    const projectB = await createProject("Media Iso B");
    await mediaRepo.addMedia(projectA.id, {
      kind: "logo",
      name: "A logo",
      sourceUrl: "https://images.example.com/a-logo.png",
    });
    await mediaRepo.addMedia(projectB.id, {
      kind: "logo",
      name: "B logo",
      sourceUrl: "https://images.example.com/b-logo.png",
    });
    const mediaA = await mediaRepo.listMedia(projectA.id);
    expect(mediaA).toHaveLength(1);
    expect(mediaA[0].name).toBe("A logo");
  });
});

describe("deterministic generation provider", () => {
  it("returns valid content plus complete generation metadata", async () => {
    const result = await provider.generateWebsiteDraft(makeInput(briefA));
    expect(result.content.hero.title).toContain("Amani Solar Ltd");
    expect(result.metadata.provider).toBe("deterministic-local");
    expect(result.metadata.promptVersion).toBe("deterministic-v1");
    expect(result.metadata.templateVersion).toBe(template.version);
    expect(result.metadata.inputHash).toMatch(/^[0-9a-f]{32}$/);
    expect(result.metadata.generatedAt).toBeTruthy();
  });

  it("is stable for the same canonical input", async () => {
    const input = makeInput(briefA);
    const a = await provider.generateWebsiteDraft(input);
    const b = await provider.generateWebsiteDraft(input);
    expect(a.metadata.inputHash).toBe(b.metadata.inputHash);
    expect(a.content).toEqual(b.content);
    expect(canonicalize({ b: 2, a: 1 })).toBe(canonicalize({ a: 1, b: 2 }));
  });

  it("different project briefs produce different hero content", async () => {
    const a = await provider.generateWebsiteDraft(makeInput(briefA));
    const b = await provider.generateWebsiteDraft(makeInput(briefB));
    expect(a.content.hero.title).not.toBe(b.content.hero.title);
    expect(a.metadata.inputHash).not.toBe(b.metadata.inputHash);
  });

  it("uses only approved media; none → null hero image, still valid", async () => {
    const result = await provider.generateWebsiteDraft(makeInput(briefA));
    expect(result.content.hero.image?.url).toBe(
      "https://images.example.com/hero.jpg"
    );
    const noMedia = await provider.generateWebsiteDraft({
      ...makeInput(briefA),
      media: [],
    });
    expect(noMedia.content.hero.image).toBeNull();
  });

  it("never performs a network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await provider.generateWebsiteDraft(makeInput(briefA));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(computeInputHash(makeInput(briefA))).toMatch(/^[0-9a-f]{32}$/);
  });

  it("renders generated content through the existing HomeTemplate", async () => {
    const result = await provider.generateWebsiteDraft(makeInput(briefA));
    expect(() => HomeTemplate({ content: result.content })).not.toThrow();
  });

  it("generation failure preserves the previous draft", async () => {
    const project = await createProject("Failure Co");
    const good = await draftRepo.createDraft({
      projectId: project.id,
      templateId: template.id,
      content: (await provider.generateWebsiteDraft(makeInput(briefA))).content,
      source: "manual",
    });

    const invalid = (await provider.generateWebsiteDraft(makeInput(briefA)))
      .content;
    await expect(
      draftRepo.createDraft({
        projectId: project.id,
        templateId: template.id,
        content: { ...invalid, hero: { ...invalid.hero, title: "" } },
        source: "manual",
      })
    ).rejects.toThrow(/HomeContentSchema/);

    const drafts = await draftRepo.listDrafts(project.id);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].id).toBe(good.id);
  });

  it("services and FAQs keep stable IDs across generations", async () => {
    const a = await provider.generateWebsiteDraft(makeInput(briefA));
    const b = await provider.generateWebsiteDraft(makeInput(briefA));
    expect(a.content.services.items.map((s) => s.id)).toEqual(
      b.content.services.items.map((s) => s.id)
    );
    expect(a.content.faqs.items.map((f) => f.id)).toEqual(
      b.content.faqs.items.map((f) => f.id)
    );
  });
});

describe("sidebar helpers", () => {
  it("highlights the active link correctly", () => {
    expect(isActivePath("/dashboard", "/dashboard")).toBe(true);
    expect(isActivePath("/projects", "/projects")).toBe(true);
    expect(isActivePath("/projects/proj_1/brief", "/projects/proj_1/brief")).toBe(true);
    expect(isActivePath("/projects/proj_1/brief", "/projects/proj_1")).toBe(false);
    expect(isActivePath("/projects/proj_2/brief", "/projects/proj_1/brief")).toBe(false);
    expect(isActivePath("/preview", "/dashboard")).toBe(false);
  });

  it("derives the current project id from the pathname", () => {
    expect(projectIdFromPath("/projects/proj_1/brief")).toBe("proj_1");
    expect(projectIdFromPath("/projects")).toBeNull();
    expect(projectIdFromPath("/dashboard")).toBeNull();
  });
});

async function createProject(name: string) {
  return projectRepo.createProject({
    name,
    prospectName: name,
    industry: "tech",
    templateId: "premium-professional-services-home",
  });
}

beforeEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});
