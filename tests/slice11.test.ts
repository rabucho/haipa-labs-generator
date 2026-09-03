import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { rmSync } from "fs";
import { join } from "path";
import {
  ConnectionInputSchema,
  saveConnection,
  verifyPageBinding,
  toConnectionView,
} from "@/lib/wordpress-staging/connection";
import { diffHomeContent } from "@/lib/wordpress-staging/diff";
import {
  StagingWordPressProvider,
} from "@/lib/wordpress-staging/provider";
import { syncHistoryRepository } from "@/lib/wordpress-staging/sync-repository";
import { getWordPressStagingConfig } from "@/lib/wordpress-staging/config";
import type { AuthContext } from "@/lib/auth/session";
import type { HomeContent } from "@/types/content";

const dataDir = join(process.cwd(), ".slice11-test-data");
process.env.PROJECTS_DATA_DIR = dataDir;

const auth: AuthContext = {
  userId: "op-1",
  email: "operator@haipalabs.local",
  role: "operator",
};

beforeAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

// ── Connection input validation ─────────────────────────────────────────

describe("connection input validation", () => {
  it("accepts a staging binding by page id", () => {
    const r = ConnectionInputSchema.safeParse({ targetKey: "staging", pageId: 6 });
    expect(r.success).toBe(true);
  });

  it("accepts a staging binding by slug", () => {
    const r = ConnectionInputSchema.safeParse({ targetKey: "staging", pageSlug: "home" });
    expect(r.success).toBe(true);
  });

  it("rejects a non-allowlisted target key (arbitrary URL/host)", () => {
    for (const bad of ["production", "https://evil.example.com", ""]) {
      const r = ConnectionInputSchema.safeParse({ targetKey: bad, pageId: 1 });
      expect(r.success).toBe(false);
    }
  });

  it("rejects invalid page ids", () => {
    for (const bad of [0, -1, 1.5]) {
      const r = ConnectionInputSchema.safeParse({ targetKey: "staging", pageId: bad });
      expect(r.success).toBe(false);
    }
  });

  it("rejects unsafe slugs", () => {
    for (const bad of ["../etc", "Home Page", "a;b", "drop table"]) {
      const r = ConnectionInputSchema.safeParse({ targetKey: "staging", pageSlug: bad });
      expect(r.success).toBe(false);
    }
  });

  it("rejects a binding with neither id nor slug", () => {
    const r = ConnectionInputSchema.safeParse({ targetKey: "staging" });
    expect(r.success).toBe(false);
  });
});

// ── Persistence + isolation (local repository mode) ─────────────────────

describe("connection persistence and isolation", () => {
  it("saves and reloads a project binding", async () => {
    const created = await createProject("Slice Eleven A");
    const result = await saveConnection(auth, created.id, {
      targetKey: "staging",
      pageId: 6,
      pageSlug: "home",
    });
    expect(result.ok).toBe(true);

    const reloaded = await loadProject(created.id);
    expect(reloaded?.wordpressConnection?.pageId).toBe(6);
    expect(reloaded?.wordpressConnection?.pageSlug).toBe("home");
    expect(reloaded?.wordpressConnection?.targetKey).toBe("staging");
  });

  it("resets page verification when the binding changes", async () => {
    const created = await createProject("Slice Eleven B");
    await saveConnection(auth, created.id, { targetKey: "staging", pageSlug: "home" });
    const repos = await scopedRepos();
    // Simulate a previously verified state.
    await repos.projects.updateProject(created.id, {
      wordpressConnection: {
        targetKey: "staging",
        pageSlug: "home",
        credentialReference: "WORDPRESS_APPLICATION_PASSWORD",
        pageVerified: true,
      },
    });
    await saveConnection(auth, created.id, { targetKey: "staging", pageSlug: "about" });
    const reloaded = await loadProject(created.id);
    expect(reloaded?.wordpressConnection?.pageVerified).toBe(false);
    expect(reloaded?.wordpressConnection?.pageSlug).toBe("about");
  });

  it("never writes Project B when saving Project A", async () => {
    const a = await createProject("Isolation A");
    const b = await createProject("Isolation B");
    await saveConnection(auth, a.id, { targetKey: "staging", pageId: 11 });
    const bLoaded = await loadProject(b.id);
    expect(bLoaded?.wordpressConnection).toBeUndefined();
  });

  it("rejects binding for an unknown project", async () => {
    const result = await saveConnection(auth, "proj_does_not_exist", {
      targetKey: "staging",
      pageId: 1,
    });
    expect(result.ok).toBe(false);
  });
});

// ── Redaction ───────────────────────────────────────────────────────────

describe("connection view redaction", () => {
  it("never exposes the credential reference or any secret", () => {
    const config = getWordPressStagingConfig();
    const view = toConnectionView(
      {
        targetKey: "staging",
        pageSlug: "home",
        credentialReference: "WORDPRESS_APPLICATION_PASSWORD",
        pageVerified: true,
      },
      config
    );
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("credentialReference");
    expect(serialized).not.toContain("WORDPRESS_APPLICATION_PASSWORD");
    expect(serialized).not.toContain("password");
    expect(view.authConfigured).toBeTypeOf("boolean");
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────

async function scopedRepos() {
  const { getScopedRepositories } = await import("@/lib/auth/guards");
  return getScopedRepositories(auth);
}

async function createProject(name: string) {
  const repos = await scopedRepos();
  return repos.projects.createProject({
    name,
    prospectName: name,
    industry: "Testing",
    templateId: "premium-professional-services-home",
  });
}

async function loadProject(id: string) {
  const repos = await scopedRepos();
  return repos.projects.loadProject(id);
}

// Shared valid content for provider/diff tests.
const validContent: HomeContent = {
  hero: {
    eyebrow: "E",
    title: "Slice 11 hero",
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
  footer: { copyright: "(c) Test" },
};

// ── Page verification (provider contract, stubbed fetch) ────────────────

describe("page verification (stubbed staging)", () => {
  beforeAll(() => {
    process.env.WORDPRESS_INTEGRATION_ENABLED = "true";
    process.env.WORDPRESS_STAGING_URL = "https://staging.example.test";
    process.env.WORDPRESS_AUTH_MODE = "application-password";
    process.env.WORDPRESS_AUTH_SECRET_REFERENCE = "WORDPRESS_APPLICATION_PASSWORD";
    process.env.WORDPRESS_APPLICATION_PASSWORD = "test-operator:staging-secret";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stubPageResponse(page: Record<string, unknown> | null) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(page ? [page] : []),
      })
    );
  }

  it("verifies the bound page and persists the flag (read-only GETs)", async () => {
    const project = await createProject("Verify A");
    await saveConnection(auth, project.id, { targetKey: "staging", pageSlug: "home" });
    stubPageResponse({ id: "6", slug: "home", status: "publish" });

    const result = await verifyPageBinding(auth, project.id);
    expect(result.ok).toBe(true);
    const reloaded = await loadProject(project.id);
    expect(reloaded?.wordpressConnection?.pageVerified).toBe(true);

    // Read-only: only GET requests to the allowlisted origin.
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<
      [string, RequestInit?]
    >;
    for (const [url, init] of calls) {
      expect(String(url)).toContain("staging.example.test");
      expect(init?.method ?? "GET").toBe("GET");
    }
    const history = await syncHistoryRepository.list(project.id);
    const entries = history.filter((r) => r.operation === "page-verify");
    expect(entries.length).toBe(1);
    expect(entries[0].status).toBe("success");
  });

  it("fails safely when the page does not exist", async () => {
    const project = await createProject("Verify B");
    await saveConnection(auth, project.id, { targetKey: "staging", pageSlug: "missing" });
    stubPageResponse(null);

    const result = await verifyPageBinding(auth, project.id);
    expect(result.ok).toBe(false);
    const reloaded = await loadProject(project.id);
    expect(reloaded?.wordpressConnection?.pageVerified).toBe(false);
    const history = await syncHistoryRepository.list(project.id);
    const entries = history.filter((r) => r.operation === "page-verify");
    expect(entries[entries.length - 1].status).toBe("failure");
  });

  it("does not leak the credential or raw bodies in verification output", async () => {
    const project = await createProject("Verify C");
    await saveConnection(auth, project.id, { targetKey: "staging", pageSlug: "home" });
    stubPageResponse({ id: "6", slug: "home", status: "publish" });

    const result = await verifyPageBinding(auth, project.id);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("staging-secret");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("credentialReference");
  });
});

// ── locatePage contract ─────────────────────────────────────────────────

describe("provider locatePage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function providerWith(config: Partial<ReturnType<typeof getWordPressStagingConfig>>) {
    const base = getWordPressStagingConfig();
    return new StagingWordPressProvider({ ...base, ...config });
  }

  it("reports misconfigured when disabled (zero network)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const p = providerWith({ enabled: false, stagingUrl: null });
    const r = await p.locatePage({ pageSlug: "home" });
    expect(r.found).toBe(false);
    expect(r.errorCode).toBe("misconfigured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("finds a page by id and enforces slug agreement", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: "6", slug: "home", status: "publish" }),
      })
    );
    const p = providerWith({ enabled: true, stagingUrl: "https://staging.example.test" });
    const byId = await p.locatePage({ pageId: 6 });
    expect(byId.found).toBe(true);
    expect(byId.page?.slug).toBe("home");

    const mismatched = await p.locatePage({ pageId: 6, pageSlug: "about" });
    expect(mismatched.found).toBe(false);
    expect(mismatched.errorCode).toBe("page-not-found");
  });

  it("maps auth failures to a safe error code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: () => Promise.resolve({}) })
    );
    const p = providerWith({ enabled: true, stagingUrl: "https://staging.example.test" });
    const r = await p.locatePage({ pageSlug: "home" });
    expect(r.found).toBe(false);
    expect(r.errorCode).toBe("auth-failed");
  });
});

// ── Diff semantics ──────────────────────────────────────────────────────

function clone(content: HomeContent): HomeContent {
  return JSON.parse(JSON.stringify(content)) as HomeContent;
}

describe("draft-versus-staging diff", () => {
  it("reports no changes for identical content", () => {
    const diff = diffHomeContent(validContent, clone(validContent));
    expect(diff.unchanged).toBe(true);
  });

  it("is deterministic", () => {
    const staging = clone(validContent);
    staging.hero.title = "Changed title";
    const a = diffHomeContent(validContent, staging);
    const b = diffHomeContent(validContent, clone(staging));
    expect(a).toEqual(b);
  });

  it("performs zero network calls", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    diffHomeContent(validContent, clone(validContent));
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("detects text, link, and image changes", () => {
    const staging = clone(validContent);
    staging.hero.title = "New title";
    staging.hero.primaryCta.href = "/new-contact";
    staging.hero.image = { url: "https://staging.example.test/x.jpg", alt: "x" };
    const diff = diffHomeContent(validContent, staging);
    expect(diff.text.some((c) => c.path === "hero.title")).toBe(true);
    expect(diff.links.some((c) => c.path === "hero.primaryCta.href")).toBe(true);
    expect(diff.images.some((c) => c.path === "hero.image")).toBe(true);
    expect(diff.unchanged).toBe(false);
  });

  it("compares services by stable id, not array position", () => {
    const staging = clone(validContent);
    staging.services.items = [...staging.services.items].reverse();
    const reordered = diffHomeContent(validContent, staging);
    expect(reordered.services.changed.length).toBe(0);
    expect(reordered.unchanged).toBe(true);

    const changed = clone(validContent);
    changed.services.items[0].title = "Renamed";
    const d1 = diffHomeContent(validContent, changed);
    expect(d1.services.changed).toEqual([
      { id: "srv_1", field: "title", draft: "One", staging: "Renamed" },
    ]);

    const added = clone(validContent);
    added.services.items.push({ id: "srv_2", title: "Two", description: "D2" });
    const d2 = diffHomeContent(validContent, added);
    expect(d2.services.added).toEqual(["srv_2"]);

    const removed = clone(validContent);
    removed.services.items = [];
    const d3 = diffHomeContent(validContent, removed);
    expect(d3.services.removed).toEqual(["srv_1"]);
  });

  it("detects FAQ changes by stable id", () => {
    const staging = clone(validContent);
    staging.faqs.items[0].answer = "Updated answer.";
    const diff = diffHomeContent(validContent, staging);
    expect(diff.faqs.changed).toEqual([
      { id: "faq_1", field: "answer", draft: "A.", staging: "Updated answer." },
    ]);
  });

  it("truncates long values for display", () => {
    const staging = clone(validContent);
    staging.hero.title = "x".repeat(300);
    const diff = diffHomeContent(validContent, staging);
    const change = diff.text.find((c) => c.path === "hero.title")!;
    expect(change.staging.length).toBeLessThanOrEqual(81);
    expect(change.staging.endsWith("…")).toBe(true);
  });

  it("contains only editable content paths (no design-controlled keys)", () => {
    const staging = clone(validContent);
    staging.hero.title = "Other";
    const serialized = JSON.stringify(diffHomeContent(validContent, staging));
    expect(serialized).not.toContain("layout.spacing");
    expect(serialized).not.toContain("layout.colors");
    expect(serialized).not.toContain("layout.typography");
  });
});
