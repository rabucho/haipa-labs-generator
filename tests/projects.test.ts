import { describe, it, expect, beforeEach } from "vitest";
import { rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { homeFixture } from "@/content/home.fixture";
import {
  JsonFileProjectRepository,
  isValidProjectId,
  slugifyName,
} from "@/lib/projects/project-repository";
import { JsonFileProjectDraftRepository } from "@/lib/projects/draft-repository";

describe("project id / slug helpers", () => {
  it("rejects invalid project ids (path-traversal safety)", () => {
    expect(isValidProjectId("proj_abc-123")).toBe(true);
    expect(isValidProjectId("../etc/passwd")).toBe(false);
    expect(isValidProjectId("")).toBe(false);
    expect(isValidProjectId("a".repeat(81))).toBe(false);
  });

  it("slugifies names deterministically", () => {
    expect(slugifyName("Amani Tech Consulting!")).toBe("amani-tech-consulting");
  });
});

describe("project + draft repositories (JSON file, project-scoped)", () => {
  const dataDir = join(tmpdir(), `omoka-test-${Date.now()}`);
  const repo = new JsonFileProjectRepository();
  const draftRepo = new JsonFileProjectDraftRepository();

  beforeEach(() => {
    process.env.PROJECTS_DATA_DIR = dataDir;
    rmSync(join(dataDir, "projects"), { recursive: true, force: true });
  });

  it("creates a project with a unique slug and brief status", async () => {
    const project = await repo.createProject({
      name: "Amani Tech",
      prospectName: "Amani Ltd",
      industry: "professional-services",
      templateId: "premium-professional-services-home",
    });
    expect(project.id).toMatch(/^proj_/);
    expect(project.slug).toBe("amani-tech");
    expect(project.status).toBe("brief");

    const second = await repo.createProject({
      name: "Amani Tech",
      prospectName: "Another",
      industry: "hospitality",
      templateId: "premium-professional-services-home",
    });
    expect(second.slug).toBe("amani-tech-2");
  });

  it("lists and loads projects by id", async () => {
    const project = await repo.createProject({
      name: "Kilima Lodge",
      prospectName: "Kilima",
      industry: "hospitality",
      templateId: "premium-professional-services-home",
    });
    const loaded = await repo.loadProject(project.id);
    expect(loaded?.name).toBe("Kilima Lodge");
    expect(await repo.loadProject("does_not_exist")).toBeNull();
  });

  it("rejects invalid draft content (schema gate)", async () => {
    const project = await repo.createProject({
      name: "Bad Draft Co",
      prospectName: "BDC",
      industry: "tech",
      templateId: "premium-professional-services-home",
    });
    await expect(
      draftRepo.createDraft({
        projectId: project.id,
        templateId: project.templateId,
        content: { ...homeFixture, hero: { ...homeFixture.hero, title: "" } },
        source: "manual",
      })
    ).rejects.toThrow(/HomeContentSchema/);
  });

  it("creates, loads, and approves a valid draft with stable IDs", async () => {
    const project = await repo.createProject({
      name: "Good Draft Co",
      prospectName: "GDC",
      industry: "tech",
      templateId: "premium-professional-services-home",
    });
    const draft = await draftRepo.createDraft({
      projectId: project.id,
      templateId: project.templateId,
      content: homeFixture,
      source: "fixture",
    });
    expect(draft.content.services.items[0].id).toBe("srv_1");
    expect(draft.approved).toBe(false);

    const loaded = await draftRepo.loadDraft(project.id, draft.id);
    expect(loaded?.content.hero.title).toBe(homeFixture.hero.title);

    const approved = await draftRepo.setApproved(project.id, draft.id, true);
    expect(approved?.approved).toBe(true);
  });

  it("updates project status and current draft pointer", async () => {
    const project = await repo.createProject({
      name: "Pointer Co",
      prospectName: "PC",
      industry: "tech",
      templateId: "premium-professional-services-home",
    });
    const draft = await draftRepo.createDraft({
      projectId: project.id,
      templateId: project.templateId,
      content: homeFixture,
      source: "fixture",
    });
    const updated = await repo.updateProject(project.id, {
      status: "draft",
      currentDraftId: draft.id,
    });
    expect(updated?.status).toBe("draft");
    expect(updated?.currentDraftId).toBe(draft.id);
  });
});
