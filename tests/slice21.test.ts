import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { rmSync } from "fs";
import { join } from "path";
import {
  validatePackageImport,
  findUnsafeContent,
  buildTemplatePackage,
  TEMPLATE_PACKAGE_VERSION,
} from "@/lib/templates/package";
import { templateVersionStore } from "@/lib/templates/version-store";
import { DEFAULT_BUILDER_DOCUMENT } from "@/types/builder";
import { projectRepository } from "@/lib/projects/project-repository";
import { projectDraftRepository } from "@/lib/projects/draft-repository";
import type { AuthContext } from "@/lib/auth/session";
import type { HomeContent } from "@/types/content";

const dataDir = join(process.cwd(), ".slice21-test-data");
const auth: AuthContext = {
  userId: "op-21",
  email: "tpl@haipalabs.local",
  role: "operator",
};

beforeAll(() => {
  process.env.PROJECTS_DATA_DIR = join(dataDir, "projects");
  process.env.TEMPLATES_DATA_DIR = join(process.cwd(), ".slice21-templates");
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(join(process.cwd(), ".slice21-templates"), {
    recursive: true,
    force: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function pkg(overrides: Record<string, unknown> = {}) {
  return {
    packageVersion: TEMPLATE_PACKAGE_VERSION,
    family: { key: "corporate-services", name: "Corporate Services" },
    version: "1.2.0",
    document: { ...DEFAULT_BUILDER_DOCUMENT, templateVersion: "1.2.0" },
    provenance: { source: "external-import", label: "partner pack" },
    ...overrides,
  };
}

const existing: Array<{ familyKey: string; version: string }> = [
  { familyKey: "premium-professional-services-home", version: "1.0.1" },
];

// ── Sidebar discoverability ──────────────────────────────────────────────

describe("Templates sidebar discoverability", () => {
  it("registers a /templates link in the main sidebar navigation", async () => {
    const { readFileSync } = await import("fs");
    const src = readFileSync(
      join(process.cwd(), "src/components/app/AppSidebar.tsx"),
      "utf-8"
    );
    expect(src).toContain('href: "/templates"');
    expect(src).toContain('label: "Templates"');
    const mainIdx = src.indexOf("const MAIN_LINKS");
    const toolIdx = src.indexOf("const TOOL_LINKS");
    const linkIdx = src.indexOf('href: "/templates"');
    expect(linkIdx).toBeGreaterThan(mainIdx);
    expect(linkIdx).toBeLessThan(toolIdx);
  });
});

// ── Import validation ────────────────────────────────────────────────────

describe("template package import validation", () => {
  it("accepts a valid structured package and computes a content hash", () => {
    const r = validatePackageImport(pkg(), existing, 256 * 1024, 1024);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.version).toBe("1.2.0");
      expect(r.contentHash).toHaveLength(16);
      expect(r.document).toEqual(pkg().document);
    }
  });

  it("rejects malformed/unknown-key packages via the strict schema", () => {
    const bad = pkg({ totallyUnknownField: true });
    const r = validatePackageImport(bad, existing, 256 * 1024, 512);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain("schema validation");
  });

  it("rejects a wrong packageVersion", () => {
    const r = validatePackageImport(pkg({ packageVersion: "9.9" }), existing, 256 * 1024, 512);
    expect(r.ok).toBe(false);
  });

  it("rejects oversized packages before parsing semantics", () => {
    const r = validatePackageImport(pkg(), existing, 100, 4096);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain("size limit");
  });

  it("rejects script/JSX/HTML injection anywhere in the document", () => {
    const injected = pkg({
      document: {
        ...DEFAULT_BUILDER_DOCUMENT,
        templateVersion: "1.2.0",
        pages: [
          {
            ...DEFAULT_BUILDER_DOCUMENT.pages[0],
            sections: [
              {
                instanceId: "<script>alert(1)</script>",
                sectionType: "hero",
                order: 0,
              },
            ],
          },
        ],
      },
    });
    const r = validatePackageImport(injected, existing, 256 * 1024, 2048);
    // The package MUST be rejected — by the unsafe-content scan OR by the
    // strict schema (which also refuses code-like instance ids). Either
    // guard firing is a safe outcome; nothing may pass.
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(
      r.errors.some(
        (e) => e.includes("code-like content") || e.includes("schema validation")
      )
    ).toBe(true);
    // Direct proof the scanner itself detects the injected script tag.
    expect(findUnsafeContent(injected.document).length).toBeGreaterThan(0);
  });

  it("rejects javascript: URIs and inline event handlers", () => {
    expect(findUnsafeContent({ token: "javascript:void(0)" }).length).toBeGreaterThan(0);
    expect(findUnsafeContent({ token: "onerror=alert(1)" }).length).toBeGreaterThan(0);
  });

  it("rejects unknown section types through the strict document schema", () => {
    const bad = pkg({
      document: {
        ...DEFAULT_BUILDER_DOCUMENT,
        pages: [
          {
            pageKey: "home",
            enabled: true,
            sections: [{ instanceId: "s1", sectionType: "mystery", order: 0 }],
          },
        ],
      },
    });
    const r = validatePackageImport(bad, existing, 256 * 1024, 1024);
    expect(r.ok).toBe(false);
  });

  it("rejects unsafe design-token values via the token schema", () => {
    const bad = pkg({
      document: {
        ...DEFAULT_BUILDER_DOCUMENT,
        designTokens: { "color-primary": "#GGGGGG" },
      },
    });
    const r = validatePackageImport(bad, existing, 256 * 1024, 1024);
    expect(r.ok).toBe(false);
  });

  it("rejects duplicate family+version imports (never overwrites)", () => {
    const dupExisting = [{ familyKey: "corporate-services", version: "1.2.0" }];
    const r = validatePackageImport(pkg(), dupExisting, 256 * 1024, 1024);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain("never overwritten");
  });
});

// ── Import persistence, provenance, and round-trip ───────────────────────

describe("import persistence and round-trip", () => {
  it("imports as a NEW draft with provenance and content hash", async () => {
    const check = validatePackageImport(pkg(), existing, 256 * 1024, 1024);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const imported = await templateVersionStore.importDraft({
      familyKey: check.family.key,
      displayName: check.family.name,
      version: check.version,
      document: check.document,
      actorId: auth.userId,
      provenance: { source: "external-import", label: "partner pack" },
    });
    expect(imported.ok).toBe(true);
    if (imported.ok) {
      expect(imported.version.status).toBe("draft");
      expect(imported.version.provenance?.source).toBe("external-import");
      expect(imported.version.provenance?.importedBy).toBe(auth.userId);
      expect(imported.version.provenance?.contentHash).toBe(check.contentHash);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("export → import round-trips the canonical document without executing code", async () => {
    const created = await templateVersionStore.createFamilyDraft({
      familyKey: "roundtrip-family",
      displayName: "Round Trip",
      createdBy: auth.userId,
    });
    const exported = buildTemplatePackage({
      familyKey: created.familyKey,
      familyName: "Round Trip",
      version: created.version,
      document: created.document,
      source: "omoka-export",
    });
    // Serialize + re-parse exactly like a file download/upload would.
    const roundTripped = JSON.parse(JSON.stringify(exported));
    const check = validatePackageImport(roundTripped, [], 256 * 1024, 2048);
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.document).toEqual(created.document);
      expect(check.contentHash).toBe(created.contentHash);
    }
  });

  it("importDraft enforces the duplicate guard at the store level", async () => {
    const first = await templateVersionStore.importDraft({
      familyKey: "dup-family",
      displayName: "Dup",
      version: "2.0.0",
      document: DEFAULT_BUILDER_DOCUMENT,
      actorId: auth.userId,
      provenance: { source: "external-import" },
    });
    expect(first.ok).toBe(true);
    const second = await templateVersionStore.importDraft({
      familyKey: "dup-family",
      displayName: "Dup",
      version: "2.0.0",
      document: DEFAULT_BUILDER_DOCUMENT,
      actorId: auth.userId,
      provenance: { source: "external-import" },
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.errors[0]).toContain("never overwritten");
  });
});

// ── Archive gating and project pinning ───────────────────────────────────

describe("archive gating and project pinning", () => {
  it("pins, blocks immutability, keeps archived versions readable", async () => {
    const check = validatePackageImport(pkg(), existing, 256 * 1024, 1024);
    if (!check.ok) throw new Error("fixture invalid");
    const imported = await templateVersionStore.importDraft({
      familyKey: "archive-family",
      displayName: "Archive Family",
      version: "1.0.0",
      document: check.document,
      actorId: auth.userId,
      provenance: { source: "external-import" },
    });
    if (!imported.ok) throw new Error("import failed");
    await templateVersionStore.publish(imported.version.versionId, auth.userId);

    const repos = (await import("@/lib/auth/guards")).getScopedRepositories(auth);
    const project = await repos.projects.createProject({
      name: "Pinned 21",
      prospectName: "Pinned 21",
      industry: "Testing",
      templateId: "premium-professional-services-home",
    });
    await repos.projects.updateProject(project.id, {
      templateVersionId: imported.version.versionId,
    });

    // Usage view: safe fields only — no brief/media/credentials leakage.
    const usage = (await projectRepository.listProjects()).filter(
      (p) => p.templateVersionId === imported.version.versionId
    );
    expect(usage.length).toBe(1);
    expect(JSON.stringify(usage[0])).not.toContain("wordpressConnection");
    expect(JSON.stringify(usage[0])).not.toContain("brandBrief");

    // Default change must not repin the existing project.
    await templateVersionStore.setDefault(imported.version.versionId);
    const reloaded = await repos.projects.loadProject(project.id);
    expect(reloaded?.templateVersionId).toBe(imported.version.versionId);

    // Published versions are immutable — edits require duplicate-as-draft.
    const mutated = await templateVersionStore.saveDraftDocument(
      imported.version.versionId,
      DEFAULT_BUILDER_DOCUMENT,
      auth.userId
    );
    expect(mutated.ok).toBe(false);

    // Archived versions remain readable; the project stays pinned.
    await templateVersionStore.setStatus(imported.version.versionId, "archived", auth.userId);
    const stillReadable = await templateVersionStore.get(imported.version.versionId);
    expect(stillReadable?.status).toBe("archived");
    const afterArchive = await repos.projects.loadProject(project.id);
    expect(afterArchive?.templateVersionId).toBe(imported.version.versionId);
  });

  it("legacy HomeContent projects keep rendering unchanged (compatibility)", async () => {
    const repos = (await import("@/lib/auth/guards")).getScopedRepositories(auth);
    const project = await repos.projects.createProject({
      name: "Compat 21",
      prospectName: "Compat 21",
      industry: "Testing",
      templateId: "premium-professional-services-home",
    });
    const content: HomeContent = {
      hero: {
        eyebrow: "E",
        title: "Slice 21 compat",
        body: "Body",
        primaryCta: { label: "C", href: "/c" },
        image: null,
      },
      about: { eyebrow: "", title: "A", body: "AB" },
      services: {
        eyebrow: "",
        title: "S",
        items: [{ id: "srv_1", title: "One", description: "D" }],
      },
      faqs: { eyebrow: "", title: "F", items: [{ id: "faq_1", question: "Q", answer: "A" }] },
      contact: { title: "C", phone: "+254 700 000 000", email: "a@b.co", address: "N" },
      footer: { copyright: "(c)" },
    };
    const draft = await projectDraftRepository.createDraft({
      projectId: project.id,
      templateId: "premium-professional-services-home",
      content,
      source: "manual",
    });
    expect(draft.content.hero.title).toBe("Slice 21 compat");
  });
});
