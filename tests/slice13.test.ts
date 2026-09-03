import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { rmSync } from "fs";
import { join } from "path";
import {
  buildPageAwareInventory,
  reviewMarkersByPage,
} from "@/lib/templates/page-inventory";
import {
  resolveGenerationProvider,
  listProviderDescriptors,
} from "@/lib/generation/provider-registry";
import {
  migrationPreview,
  executeMigration,
} from "@/lib/projects/site-migration";
import { projectDraftRepository } from "@/lib/projects/draft-repository";
import type { AuthContext } from "@/lib/auth/session";
import type { HomeContent } from "@/types/content";

const dataDir = join(process.cwd(), ".slice13-test-data");
process.env.PROJECTS_DATA_DIR = dataDir;

const auth: AuthContext = {
  userId: "op-1",
  email: "operator@haipalabs.local",
  role: "operator",
};

beforeAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

// ── Provider selection (Stage A) ────────────────────────────────────────

describe("openrouter/free router gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("rejects openrouter/free unless explicitly allowed, with a non-determinism warning", () => {
    vi.stubEnv("AI_OPENROUTER_ENABLED", "true");
    vi.stubEnv("AI_OPENROUTER_MODEL", "openrouter/free");
    vi.stubEnv("AI_OPENROUTER_API_KEY", "test-key");
    const r = resolveGenerationProvider("openrouter");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorCode).toBe("disabled");
      expect(r.errors.join(" ")).toMatch(/non-deterministic/i);
    }
  });

  it("allows openrouter/free only when the flag is explicitly true", () => {
    vi.stubEnv("AI_OPENROUTER_ENABLED", "true");
    vi.stubEnv("AI_OPENROUTER_MODEL", "openrouter/free");
    vi.stubEnv("AI_OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("AI_OPENROUTER_ALLOW_FREE_ROUTER", "true");
    const r = resolveGenerationProvider("openrouter");
    expect(r.ok).toBe(true);
  });

  it("supports explicit model selection (reproducible slug)", () => {
    vi.stubEnv("AI_OPENROUTER_ENABLED", "true");
    vi.stubEnv("AI_OPENROUTER_MODEL", "meta-llama/llama-3.1-8b-instruct");
    vi.stubEnv("AI_OPENROUTER_API_KEY", "test-key");
    const r = resolveGenerationProvider(
      "openrouter",
      "meta-llama/llama-3.1-70b-instruct"
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.model).toBe("meta-llama/llama-3.1-70b-instruct");
      expect(r.providerId).toBe("openrouter");
    }
  });

  it("catalog never exposes credentials", () => {
    vi.stubEnv("AI_OPENROUTER_ENABLED", "true");
    vi.stubEnv("AI_OPENROUTER_API_KEY", "sk-super-secret");
    const serialized = JSON.stringify(listProviderDescriptors());
    expect(serialized).not.toContain("sk-super-secret");
    vi.unstubAllEnvs();
  });
});

// ── Page-aware inventory (Stage E groundwork) ───────────────────────────

describe("page-aware inventory", () => {
  const inventory = buildPageAwareInventory();

  it("maps every editable field exactly once with a page key", () => {
    const paths = inventory.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.length).toBeGreaterThan(20);
    for (const field of inventory) {
      expect(["home", "about", "services", "faqs", "contact"]).toContain(field.pageKey);
    }
  });

  it("groups expected fields under their pages", () => {
    const byPage = new Map<string, number>();
    for (const f of inventory) {
      byPage.set(f.pageKey, (byPage.get(f.pageKey) ?? 0) + 1);
    }
    expect(byPage.get("home")).toBeGreaterThan(0);
    expect(byPage.get("about")).toBe(3);
    expect(byPage.get("services")).toBeGreaterThan(3);
    expect(byPage.get("faqs")).toBeGreaterThan(2);
    expect(byPage.get("contact")).toBe(4);
    expect(byPage.has("shop")).toBe(false);
  });

  it("excludes design-controlled values", () => {
    expect(inventory.some((f) => !f.editable)).toBe(false);
    expect(inventory.some((f) => f.path.startsWith("layout."))).toBe(false);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(buildPageAwareInventory())).toBe(
      JSON.stringify(inventory)
    );
  });
});

describe("[For review] markers by page", () => {
  const content = {
    hero: { eyebrow: "", title: "T", body: "B" },
    about: { eyebrow: "[For review]", title: "A", body: "B" },
    services: {
      title: "S",
      items: [{ id: "srv_1", title: "x", description: "[For review]" }],
    },
    faqs: { title: "F", items: [{ id: "faq_1", question: "Q", answer: "A" }] },
    contact: { title: "C", phone: "[For review]", email: "a@b.co", address: "" },
    footer: { copyright: "(c)" },
  };

  it("groups markers under the correct page with stable paths", () => {
    const markers = reviewMarkersByPage(content);
    expect(markers).toContainEqual({ pageKey: "about", path: "about.eyebrow" });
    expect(markers).toContainEqual({
      pageKey: "services",
      path: "services[].srv_1.description",
    });
    expect(markers).toContainEqual({ pageKey: "contact", path: "contact.phone" });
  });

  it("returns no markers when nothing is marked", () => {
    const clean = {
      hero: { eyebrow: "", title: "T", body: "B" },
      about: { eyebrow: "", title: "A", body: "B" },
      services: { title: "S", items: [{ id: "s", title: "x", description: "y" }] },
      faqs: { title: "F", items: [{ id: "f", question: "Q", answer: "A" }] },
      contact: { title: "C", phone: "1", email: "a@b.co", address: "" },
      footer: { copyright: "(c)" },
    };
    expect(reviewMarkersByPage(clean)).toEqual([]);
  });
});

// ── Migration (Stage C) ─────────────────────────────────────────────────

const draftContent: HomeContent = {
  hero: {
    eyebrow: "E",
    title: "Migration hero",
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
  faqs: {
    eyebrow: "",
    title: "FAQs",
    items: [{ id: "faq_1", question: "Q?", answer: "A." }],
  },
  contact: {
    title: "Contact",
    phone: "+254 700 000 000",
    email: "t@example.com",
    address: "Nairobi",
  },
  footer: { copyright: "(c) Migration" },
};

async function setupProjectWithDraft(name: string) {
  const { getScopedRepositories } = await import("@/lib/auth/guards");
  const repos = getScopedRepositories(auth);
  const project = await repos.projects.createProject({
    name,
    prospectName: name,
    industry: "Testing",
    templateId: "premium-professional-services-home",
  });
  const draft = await projectDraftRepository.createDraft({
    projectId: project.id,
    templateId: "premium-professional-services-home",
    content: draftContent,
    source: "manual",
  });
  return { project, draft };
}

describe("SiteContent 1.0 → 2.0 migration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preview is read-only and reports pages, markers, and idempotency state", async () => {
    const { project } = await setupProjectWithDraft("Migration Preview");
    const before = await projectDraftRepository.listDrafts(project.id);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await migrationPreview(auth, project.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preview.sourceSchemaVersion).toBe("1.0");
      expect(result.preview.targetSchemaVersion).toBe("2.0");
      expect(result.preview.alreadyMigrated).toBe(false);
      expect(result.preview.pages.some((p) => p.pageKey === "home")).toBe(true);
    }
    const after = await projectDraftRepository.listDrafts(project.id);
    expect(after.length).toBe(before.length); // no mutation
    expect(fetchSpy).not.toHaveBeenCalled(); // no network
  });

  it("execute creates a NEW review draft and preserves the original", async () => {
    const { project, draft } = await setupProjectWithDraft("Migration Exec");
    const result = await executeMigration(auth, project.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migrated).toBe(true);
      expect(result.draftId).not.toBe(draft.id);
    }
    const drafts = await projectDraftRepository.listDrafts(project.id);
    expect(drafts.length).toBe(2);
    const migrated = drafts.find((d) => d.id === (result as { draftId: string }).draftId)!;
    expect(migrated.approved).toBe(false); // starts in review
    expect(migrated.source).toBe("manual");
    expect(drafts.find((d) => d.id === draft.id)?.content).toEqual(draftContent);
  });

  it("is idempotent: re-execution reuses the migrated draft", async () => {
    const { project } = await setupProjectWithDraft("Migration Idem");
    const first = await executeMigration(auth, project.id);
    const second = await executeMigration(auth, project.id);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.migrated).toBe(true);
      expect(second.alreadyMigrated).toBe(true);
      expect(second.draftId).toBe(first.draftId);
    }
    expect((await projectDraftRepository.listDrafts(project.id)).length).toBe(2);
  });

  it("performs zero network calls and stays project-scoped", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const a = await setupProjectWithDraft("Migration Iso A");
    const b = await setupProjectWithDraft("Migration Iso B");
    await executeMigration(auth, a.project.id);
    const bDrafts = await projectDraftRepository.listDrafts(b.project.id);
    expect(bDrafts.length).toBe(1); // B untouched
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails safely for an unknown project", async () => {
    const result = await migrationPreview(auth, "proj_missing");
    expect(result.ok).toBe(false);
  });
});
