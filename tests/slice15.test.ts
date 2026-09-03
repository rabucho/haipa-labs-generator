import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { rmSync } from "fs";
import { join } from "path";
import {
  BuilderDocumentSchema,
  DEFAULT_BUILDER_DOCUMENT,
  validateBuilderDocument,
  diffBuilderDocuments,
  type BuilderDocument,
} from "@/types/builder";
import { templateVersionStore } from "@/lib/templates/version-store";

const dataDir = join(process.cwd(), ".slice15-test-data");
beforeAll(() => {
  process.env.TEMPLATES_DATA_DIR = join(process.cwd(), ".slice15-templates");
  rmSync(dataDir, { recursive: true, force: true });
});

const doc: BuilderDocument = JSON.parse(JSON.stringify(DEFAULT_BUILDER_DOCUMENT));

// ── Builder document schema ─────────────────────────────────────────────

describe("builder document schema", () => {
  it("accepts the default document", () => {
    expect(BuilderDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects unknown fields (raw JSX/HTML/script cannot enter via unknown keys)", () => {
    const bad = { ...doc, customJs: "alert(1)" };
    expect(BuilderDocumentSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects invalid token values and unknown token keys", () => {
    expect(
      BuilderDocumentSchema.safeParse({
        ...doc,
        designTokens: { "--color-primary": "red" },
      }).success
    ).toBe(false);
    expect(
      BuilderDocumentSchema.safeParse({
        ...doc,
        designTokens: { "--evil-token": "x" },
      }).success
    ).toBe(false);
  });

  it("rejects unknown section types (no registered renderer)", () => {
    const bad = JSON.parse(JSON.stringify(doc));
    bad.pages[0].sections.push({
      instanceId: "sec_bad",
      sectionType: "arbitrary-jsx",
      order: 5,
    });
    expect(BuilderDocumentSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects invalid version strings", () => {
    expect(
      BuilderDocumentSchema.safeParse({ ...doc, templateVersion: "not-semver" }).success
    ).toBe(false);
  });
});

// ── Validation gates ────────────────────────────────────────────────────

describe("builder validation", () => {
  it("passes the default document", () => {
    expect(validateBuilderDocument(doc).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("rejects a disabled Home page", () => {
    const bad = JSON.parse(JSON.stringify(doc));
    (bad.pages.find((p: { pageKey: string }) => p.pageKey === "home") as { enabled: boolean }).enabled = false;
    const issues = validateBuilderDocument(bad);
    expect(issues.some((i) => i.path === "pages.home")).toBe(true);
  });

  it("rejects a missing required section", () => {
    const bad = JSON.parse(JSON.stringify(doc));
    const contact = bad.pages.find((p: { pageKey: string }) => p.pageKey === "contact");
    contact.sections = [];
    const issues = validateBuilderDocument(bad);
    expect(issues.some((i) => i.message.includes("contact"))).toBe(true);
  });

  it("rejects unsafe script-like content at the schema boundary", () => {
    const bad = JSON.parse(JSON.stringify(doc));
    bad.pages[0].sections[0].instanceId = 'x" onmouseover="alert(1)';
    expect(BuilderDocumentSchema.safeParse(bad).success).toBe(false);
  });
});

// ── Semantic diff ───────────────────────────────────────────────────────

describe("semantic builder diff", () => {
  it("identifies token, reorder, and shell changes with page/section paths", () => {
    const next = JSON.parse(JSON.stringify(doc)) as BuilderDocument;
    next.designTokens["--color-primary"] = "#123456";
    const home = next.pages.find((p) => p.pageKey === "home")!;
    home.sections = [...home.sections].reverse().map((s, i) => ({ ...s, order: i }));
    const d = diffBuilderDocuments(doc, next);
    expect(d.tokensChanged).toContainEqual({ key: "--color-primary", from: "(default)", to: "#123456" });
    expect(d.sectionsReordered.length).toBeGreaterThan(0);
    expect(d.projectsAffected).toBe("no");
  });

  it("reports no changes for identical documents", () => {
    const d = diffBuilderDocuments(doc, JSON.parse(JSON.stringify(doc)));
    expect(
      d.tokensChanged.length + d.sectionsAdded.length + d.sectionsRemoved.length + d.sectionsReordered.length
    ).toBe(0);
  });
});

// ── Version immutability (store) ────────────────────────────────────────

describe("template version store", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a draft, saves changes with a new hash, idempotent on unchanged saves", async () => {
    const created = await templateVersionStore.createFamilyDraft({
      familyKey: "test-family",
      createdBy: "op-1",
    });
    expect(created.status).toBe("draft");

    const changed = JSON.parse(JSON.stringify(created.document)) as BuilderDocument;
    changed.designTokens["--color-primary"] = "#112233";
    const saved = await templateVersionStore.saveDraftDocument(created.versionId, changed, "op-1");
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.version.contentHash).not.toBe(created.contentHash);

    const again = await templateVersionStore.saveDraftDocument(created.versionId, changed, "op-1");
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.errorCode).toBe("hash-unchanged");
  });

  it("makes published versions immutable; editing means duplicate-as-draft", async () => {
    const created = await templateVersionStore.createFamilyDraft({
      familyKey: "immutable-family",
      createdBy: "op-1",
    });
    const published = await templateVersionStore.publish(created.versionId, "op-1");
    expect(published.ok).toBe(true);

    const changed = JSON.parse(JSON.stringify(created.document)) as BuilderDocument;
    changed.designTokens["--color-primary"] = "#445566";
    const save = await templateVersionStore.saveDraftDocument(created.versionId, changed, "op-1");
    expect(save.ok).toBe(false);
    if (!save.ok) expect(save.errorCode).toBe("immutable");

    const republish = await templateVersionStore.publish(created.versionId, "op-1");
    expect(republish.ok).toBe(false);

    const dup = await templateVersionStore.duplicateAsDraft(created.versionId, "op-1");
    expect(dup.ok).toBe(true);
    if (dup.ok) {
      expect(dup.version.status).toBe("draft");
      expect(dup.version.basedOnVersionId).toBe(created.versionId);
      expect(dup.version.versionId).not.toBe(created.versionId);
    }
  });

  it("validation gates block broken documents from ever being persisted", async () => {
    const created = await templateVersionStore.createFamilyDraft({
      familyKey: "gate-family",
      createdBy: "op-1",
    });
    const broken = JSON.parse(JSON.stringify(created.document)) as BuilderDocument;
    const contact = broken.pages.find((p) => p.pageKey === "contact")!;
    contact.sections = [];
    const save = await templateVersionStore.saveDraftDocument(created.versionId, broken, "op-1");
    expect(save.ok).toBe(false);
    const published = await templateVersionStore.publish(created.versionId, "op-1");
    expect(published.ok).toBe(true);
  });

  it("set-default only accepts published versions; archived stays readable", async () => {
    const created = await templateVersionStore.createFamilyDraft({
      familyKey: "default-family",
      createdBy: "op-1",
    });
    expect((await templateVersionStore.setDefault(created.versionId)).ok).toBe(false);

    await templateVersionStore.publish(created.versionId, "op-1");
    expect((await templateVersionStore.setDefault(created.versionId)).ok).toBe(true);
    expect(await templateVersionStore.getDefaultVersionId()).toBe(created.versionId);

    await templateVersionStore.setStatus(created.versionId, "archived", "op-1");
    const stillReadable = await templateVersionStore.get(created.versionId);
    expect(stillReadable?.status).toBe("archived");
    expect(stillReadable?.document).toBeDefined();
  });

  it("performs zero WordPress/network calls", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const created = await templateVersionStore.createFamilyDraft({
      familyKey: "network-family",
      createdBy: "op-1",
    });
    await templateVersionStore.publish(created.versionId, "op-1");
    await templateVersionStore.setDefault(created.versionId);
    expect(spy).not.toHaveBeenCalled();
  });
});
