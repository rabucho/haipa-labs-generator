import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { rmSync } from "fs";
import { join } from "path";
import {
  buildMigrationPlan,
  executeMigration,
  migrateAssignment,
  rollbackMigration,
  buildDemoPackage,
} from "@/lib/projects/template-migration";
import { templateVersionStore } from "@/lib/templates/version-store";
import { projectDraftRepository } from "@/lib/projects/draft-repository";
import type { AuthContext } from "@/lib/auth/session";
import type { HomeContent } from "@/types/content";

const dataDir = join(process.cwd(), ".slice17-test-data");
const auth: AuthContext = {
  userId: "op-1",
  email: "operator@haipalabs.local",
  role: "operator",
};

beforeAll(() => {
  process.env.TEMPLATES_DATA_DIR = join(process.cwd(), ".slice17-templates");
  rmSync(dataDir, { recursive: true, force: true });
  process.env.PROJECTS_DATA_DIR = join(dataDir, "projects");
});


afterEach(() => {
  vi.restoreAllMocks();
});

const draftContent: HomeContent = {
  hero: {
    eyebrow: "E",
    title: "Slice 17 hero",
    body: "Body",
    primaryCta: { label: "Contact", href: "/contact" },
    image: null,
  },
  about: { eyebrow: "", title: "About", body: "About body" },
  services: {
    eyebrow: "",
    title: "Services",
    items: [{ id: "srv_1", title: "One", description: "D" }],
  },
  faqs: { eyebrow: "", title: "FAQs", items: [{ id: "faq_1", question: "Q?", answer: "A." }] },
  contact: {
    title: "Contact",
    phone: "+254 700 000 000",
    email: "t@example.com",
    address: "Nairobi",
  },
  footer: { copyright: "(c) Slice 17" },
};

async function setup() {
  const { getScopedRepositories } = await import("@/lib/auth/guards");
  const repos = getScopedRepositories(auth);
  const project = await repos.projects.createProject({
    name: "Migration 17",
    prospectName: "Migration 17",
    industry: "Testing",
    templateId: "premium-professional-services-home",
  });
  const draft = await projectDraftRepository.createDraft({
    projectId: project.id,
    templateId: "premium-professional-services-home",
    content: draftContent,
    source: "manual",
  });
  await repos.projects.updateProject(project.id, { currentDraftId: draft.id });
  const target = await templateVersionStore.createFamilyDraft({
    familyKey: "migration-target",
    displayName: "Migration Target",
    createdBy: "op-1",
  });
  await templateVersionStore.publish(target.versionId, "op-1");
  return { project, draft, target };
}

async function repos() {
  const { getScopedRepositories } = await import("@/lib/auth/guards");
  return getScopedRepositories(auth).projects;
}

// â”€â”€ Planner (Stage A) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("migration planner", () => {
  it("is deterministic and performs zero network calls", async () => {
    const { project, target } = await setup();
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const a = await buildMigrationPlan(auth, project.id, target.versionId);
    const b = await buildMigrationPlan(auth, project.id, target.versionId);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.plan.planHash).toBe(b.plan.planHash);
      expect(a.plan.compatible).toBe(true);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("validates target status (unpublished rejected)", async () => {
    const { project } = await setup();
    const draftVersion = await templateVersionStore.createFamilyDraft({
      familyKey: "unpublished-target",
      createdBy: "op-1",
    });
    const r = await buildMigrationPlan(auth, project.id, draftVersion.versionId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/published/i);
  });

  it("enforces project isolation (B content never in A plan)", async () => {
    const a = await setup();
    const b = await setup();
    const r = await buildMigrationPlan(auth, a.project.id, a.target.versionId);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.projectId).toBe(a.project.id);
      expect(JSON.stringify(r.plan)).not.toContain(b.project.id);
    }
  });

  it("reports fields as preserved/missing with warnings, not inventions", async () => {
    const { project, target } = await setup();
    const r = await buildMigrationPlan(auth, project.id, target.versionId);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.fieldsPreserved.length).toBeGreaterThan(0);
      expect(r.plan.warnings.length).toBeGreaterThan(0);
    }
  });
});

// â”€â”€ Execute + assignment + rollback (Stages B/D) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("migration execution and assignment", () => {
  async function migrated() {
    const s = await setup();
    const plan = await buildMigrationPlan(auth, s.project.id, s.target.versionId);
    if (!plan.ok) throw new Error("plan failed");
    const exec = await executeMigration(
      auth,
      s.project.id,
      s.target.versionId,
      plan.plan.planHash,
      true
    );
    if (!exec.ok) throw new Error("execute failed");
    return { ...s, plan: plan.plan, exec };
  }

  it("requires confirmation", async () => {
    const { project, target } = await setup();
    const plan = await buildMigrationPlan(auth, project.id, target.versionId);
    if (!plan.ok) return;
    const r = await executeMigration(
      auth,
      project.id,
      target.versionId,
      plan.plan.planHash,
      false
    );
    expect(r.ok).toBe(false);
  });

  it("creates a backup + review draft; source preserved; idempotent", async () => {
    const s = await setup();
    const plan = await buildMigrationPlan(auth, s.project.id, s.target.versionId);
    if (!plan.ok) return;
    const first = await executeMigration(
      auth,
      s.project.id,
      s.target.versionId,
      plan.plan.planHash,
      true
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const drafts = await projectDraftRepository.listDrafts(s.project.id);
    expect(drafts.length).toBe(2);
    const migrated = drafts.find((d) => d.id === first.migratedDraftId)!;
    expect(migrated.approved).toBe(false);
    expect(migrated.content).toEqual(draftContent);
    expect(drafts.find((d) => d.id === s.draft.id)?.content).toEqual(draftContent);

    const second = await executeMigration(
      auth,
      s.project.id,
      s.target.versionId,
      plan.plan.planHash,
      true
    );
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.alreadyMigrated).toBe(true);
      expect(second.migrationId).toBe(first.migrationId);
    }
    expect((await projectDraftRepository.listDrafts(s.project.id)).length).toBe(2);
  });

  it("performs zero provider/WordPress network calls", async () => {
    const s = await setup();
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const plan = await buildMigrationPlan(auth, s.project.id, s.target.versionId);
    if (!plan.ok) return;
    await executeMigration(auth, s.project.id, s.target.versionId, plan.plan.planHash, true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("assignment requires an APPROVED migrated draft; source unchanged before", async () => {
    const { project, exec } = await migrated();
    const before = await (await repos()).loadProject(project.id);
    const r = await migrateAssignment(auth, project.id, exec.migrationId, true);
    expect(r.ok).toBe(false);
    const after = await (await repos()).loadProject(project.id);
    expect(after?.templateVersionId).toBe(before?.templateVersionId);
  });

  it("assignment migrates after approval; rollback restores the source", async () => {
    const { project, exec, draft } = await migrated();
    const drafts = await projectDraftRepository.listDrafts(project.id);
    const migratedDraft = drafts.find((d) => d.id === exec.migratedDraftId)!;
    await projectDraftRepository.setApproved(project.id, migratedDraft.id, true);

    const r = await migrateAssignment(auth, project.id, exec.migrationId, true);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.status).toBe("assignment_migrated");
    const updated = await (await repos()).loadProject(project.id);
    expect(updated?.templateVersionId).not.toBeNull();

    const rb = await rollbackMigration(auth, project.id, exec.migrationId, true);
    expect(rb.ok).toBe(true);
    const restored = await (await repos()).loadProject(project.id);
    expect(restored?.templateVersionId ?? null).toBeNull();
    expect(restored?.currentDraftId).toBe(draft.id);
  });

  it("new defaults never change old assignments", async () => {
    const { project, target } = await setup();
    const newer = await templateVersionStore.createFamilyDraft({
      familyKey: target.familyKey,
      displayName: "Newer",
      basedOnVersionId: target.versionId,
      createdBy: "op-1",
    });
    await templateVersionStore.publish(newer.versionId, "op-1");
    await templateVersionStore.setDefault(newer.versionId);
    const reloaded = await (await repos()).loadProject(project.id);
    expect(reloaded?.templateVersionId ?? null).toBeNull();
  });

  it("fails safely for an unknown project", async () => {
    const target = await templateVersionStore.createFamilyDraft({
      familyKey: "missing-proj",
      createdBy: "op-1",
    });
    await templateVersionStore.publish(target.versionId, "op-1");
    const r = await buildMigrationPlan(auth, "proj_missing", target.versionId);
    expect(r.ok).toBe(false);
  });
});

// â”€â”€ Demo package (Stage E) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("demo package", () => {
  it("reports honest pending staging verification", async () => {
    const { project } = await setup();
    const r = await buildDemoPackage(auth, project.id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pkg.status).toBe("draft");
      expect(r.pkg.stagingVerificationPending).toBe(true);
      expect(r.pkg.references.preview).toBe(`/projects/${project.id}/preview`);
      expect(r.pkg.contentHash).toBeNull();
    }
  });

  it("reflects approval and stays project-scoped with zero network", async () => {
    const { project, draft } = await setup();
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await projectDraftRepository.setApproved(project.id, draft.id, true);
    const r = await buildDemoPackage(auth, project.id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pkg.status).toBe("approved");
      expect(r.pkg.approvedDraftId).toBe(draft.id);
      expect(r.pkg.contentHash).toBeTruthy();
    }
    expect(spy).not.toHaveBeenCalled();
  });
});
