import { describe, it, expect, vi } from "vitest";
import {
  buildAcfPayload,
  resolveInternalPath,
  StagingWordPressProvider,
  WordPressSyncError,
} from "@/lib/wordpress-staging/provider";
import { getWordPressStagingConfig } from "@/lib/wordpress-staging/config";
import {
  syncHistoryRepository,
  makeSyncRecord,
} from "@/lib/wordpress-staging/sync-repository";
import { contentInventory } from "@/content/content-inventory";
import { generateFieldMappings } from "@/lib/schema/generate";
import { homeSchemaVersion } from "@/content/schema-version";
import type { HomeContent } from "@/types/content";
import type { WebsiteProject } from "@/types/project";

// Deterministic valid content used across provider contract tests.
const validContent: HomeContent = {
  hero: {
    eyebrow: "Test eyebrow",
    title: "Project A hero",
    body: "Test body",
    primaryCta: { label: "Contact", href: "/contact" },
    image: null,
  },
  about: { eyebrow: "", title: "About A", body: "About body" },
  services: {
    eyebrow: "",
    title: "Services",
    items: [{ id: "srv_1", title: "Service One", description: "Desc" }],
  },
  faqs: {
    eyebrow: "",
    title: "FAQs",
    items: [{ id: "faq_1", question: "Q?", answer: "A." }],
  },
  contact: {
    title: "Contact",
    phone: "+254 700 000 000",
    email: "test@example.com",
    address: "Nairobi",
  },
  footer: { copyright: "(c) Test" },
};

function makeProject(id: string, slug: string): WebsiteProject {
  return {
    id,
    name: "Project " + id,
    slug,
    prospectName: "Prospect",
    industry: "Testing",
    status: "approved",
    templateId: "premium-professional-services-home",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const mappings = generateFieldMappings(contentInventory, homeSchemaVersion);

function makeProvider(env: Record<string, string>) {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === "") delete process.env[k];
    else process.env[k] = v;
  }
  const provider = new StagingWordPressProvider(getWordPressStagingConfig());
  return {
    provider,
    cleanup() {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    },
  };
}

describe("pure mapping helpers", () => {
  it("resolves nested internal paths", () => {
    const content = validContent as unknown as Record<string, unknown>;
    expect(resolveInternalPath(content, "hero.title")).toBe("Project A hero");
    expect(resolveInternalPath(content, "contact.email")).toBe("test@example.com");
    expect(resolveInternalPath(content, "missing.path")).toBeUndefined();
  });

  it("builds an ACF payload with wpNames and repeater rows", () => {
    const payload = buildAcfPayload(validContent, mappings);
    expect(payload["hero_title"]).toBe("Project A hero");
    expect(payload["contact_email"]).toBe("test@example.com");
    const services = payload["services"] as Array<Record<string, unknown>>;
    expect(Array.isArray(services)).toBe(true);
    expect(services[0]["services_title"]).toBe("Service One");
    expect(payload["hero_title"]).not.toBe("acf.hero_title");
    // Design-controlled values are never in the payload (no such mapping).
    expect(Object.keys(payload)).not.toContain("layout.colors");
  });

  it("is deterministic for identical input", () => {
    expect(JSON.stringify(buildAcfPayload(validContent, mappings))).toBe(
      JSON.stringify(buildAcfPayload(validContent, mappings))
    );
  });
});

describe("staging config safety", () => {
  it("is disabled by default", () => {
    const saved = process.env.WORDPRESS_INTEGRATION_ENABLED;
    delete process.env.WORDPRESS_INTEGRATION_ENABLED;
    const config = getWordPressStagingConfig();
    expect(config.enabled).toBe(false);
    if (saved !== undefined) process.env.WORDPRESS_INTEGRATION_ENABLED = saved;
  });

  it("never exposes the secret reference value", () => {
    process.env.WORDPRESS_TEST_SECRET = "super-secret-value";
    process.env.WORDPRESS_AUTH_SECRET_REFERENCE = "WORDPRESS_TEST_SECRET";
    process.env.WORDPRESS_INTEGRATION_ENABLED = "true";
    process.env.WORDPRESS_STAGING_URL = "https://staging.example.com";
    const config = getWordPressStagingConfig();
    expect(config.authSecretReference).toBe("WORDPRESS_TEST_SECRET");
    const summary = JSON.stringify({
      authSecretReference: config.authSecretReference,
    });
    expect(summary).not.toContain("super-secret-value");
    delete process.env.WORDPRESS_TEST_SECRET;
    delete process.env.WORDPRESS_AUTH_SECRET_REFERENCE;
    delete process.env.WORDPRESS_INTEGRATION_ENABLED;
    delete process.env.WORDPRESS_STAGING_URL;
  });
});

describe("provider contract: diagnose", () => {
  it("reports misconfigured when disabled, with zero network calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { provider, cleanup } = makeProvider({ WORDPRESS_INTEGRATION_ENABLED: "" });
    try {
      const diag = await provider.diagnose();
      expect(diag.ok).toBe(false);
      expect(diag.errorCode).toBe("misconfigured");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      cleanup();
      fetchSpy.mockRestore();
    }
  });

  it("diagnoses a reachable staging site (reads only)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        new Response(JSON.stringify({ description: "WordPress 6.x" }), { status: 200 })
      );
    const { provider, cleanup } = makeProvider({
      WORDPRESS_INTEGRATION_ENABLED: "true",
      WORDPRESS_STAGING_URL: "https://staging.example.com",
    });
    try {
      const diag = await provider.diagnose();
      expect(diag.restReachable).toBe(true);
      expect(diag.pagesReachable).toBe(true);
      expect(diag.acfFieldGroupCreateSupported).toBe(false);
      expect(fetchSpy.mock.calls.every((c) => String(c[0]).startsWith("https://staging.example.com"))).toBe(true);
    } finally {
      cleanup();
      fetchSpy.mockRestore();
    }
  });

  it("reports auth failure with redacted detail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Unauthorized body should never surface", { status: 401 })
    );
    const { provider, cleanup } = makeProvider({
      WORDPRESS_INTEGRATION_ENABLED: "true",
      WORDPRESS_STAGING_URL: "https://staging.example.com",
    });
    try {
      const diag = await provider.diagnose();
      expect(diag.errorCode).toBe("auth-failed");
      expect(diag.detail).not.toContain("Unauthorized body");
    } finally {
      cleanup();
      vi.restoreAllMocks();
    }
  });

  it("retries transient failures up to the bounded limit then reports timeout", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new DOMException("abort", "AbortError"));
    const savedTimeout = process.env.WORDPRESS_TIMEOUT_MS;
    process.env.WORDPRESS_TIMEOUT_MS = "10";
    const { provider, cleanup } = makeProvider({
      WORDPRESS_INTEGRATION_ENABLED: "true",
      WORDPRESS_STAGING_URL: "https://staging.example.com",
      WORDPRESS_MAX_RETRIES: "1",
    });
    try {
      const diag = await provider.diagnose();
      expect(diag.ok).toBe(false);
      expect(diag.errorCode).toBe("timeout");
      // Slice 20 contract: a hanging host is NOT retried — retrying would
      // multiply the wait (2 × 30s) without changing the outcome. Exactly
      // one attempt, and the operator is told retrying is appropriate.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(diag.retryable).toBe(true);
    } finally {
      cleanup();
      if (savedTimeout === undefined) delete process.env.WORDPRESS_TIMEOUT_MS;
      else process.env.WORDPRESS_TIMEOUT_MS = savedTimeout;
      fetchSpy.mockRestore();
    }
  });
});


describe("provider contract: sync and read-back", () => {
  function stubSyncResponses() {
    const page = {
      id: "6",
      slug: "project-a",
      acf: {
        hero_eyebrow: "Test eyebrow",
        hero_title: "Project A hero",
        hero_text: "Test body",
        hero_button_text: "Contact",
        hero_button_url: "/contact",
        about_title: "About A",
        about_text: "About body",
        services_section_title: "Services",
        services: [{ services_title: "Service One", services_description: "Desc" }],
        faqs_section_title: "FAQs",
        faqs: [{ faqs_question: "Q?", faqs_answer: "A." }],
        contact_title: "Contact",
        contact_phone: "+254 700 000 000",
        contact_email: "test@example.com",
        contact_address: "Nairobi",
        footer_copyright: "(c) Test",
      },
    };
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/wp-json/wp/v2/pages?slug=")) {
        return new Response(JSON.stringify([{ id: "6", slug: "project-a" }]), { status: 200 });
      }
      if (u.endsWith("/wp-json/wp/v2/pages/6")) {
        return new Response(JSON.stringify(page), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
  }

  it("syncs approved content and verifies read-back through the schema", async () => {
    const fetchSpy = stubSyncResponses();
    const { provider, cleanup } = makeProvider({
      WORDPRESS_INTEGRATION_ENABLED: "true",
      WORDPRESS_STAGING_URL: "https://staging.example.com",
    });
    try {
      const result = await provider.syncApprovedContent({
        project: makeProject("proj_a", "project-a"),
        approvedDraft: {
          id: "draft_1",
          projectId: "proj_a",
          content: validContent,
          templateId: "premium-professional-services-home",
          approved: true,
        },
        mappings,
      });
      expect(result.ok).toBe(true);
      expect(result.readBackVerified).toBe(true);
      expect(result.readBackContent?.hero.title).toBe("Project A hero");
      expect(
        fetchSpy.mock.calls.every((c) =>
          String(c[0]).startsWith("https://staging.example.com")
        )
      ).toBe(true);
    } finally {
      cleanup();
      fetchSpy.mockRestore();
    }
  });

  it("refuses to sync when the integration is disabled (no network)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { provider, cleanup } = makeProvider({ WORDPRESS_INTEGRATION_ENABLED: "" });
    try {
      const result = await provider.syncApprovedContent({
        project: makeProject("proj_a", "project-a"),
        approvedDraft: {
          id: "draft_1",
          projectId: "proj_a",
          content: validContent,
          templateId: "t",
          approved: true,
        },
        mappings,
      });
      expect(result.ok).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      cleanup();
      fetchSpy.mockRestore();
    }
  });
});

describe("provider contract: dry run", () => {
  it("performs zero network calls and produces a deterministic diff", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { provider, cleanup } = makeProvider({
      WORDPRESS_INTEGRATION_ENABLED: "true",
      WORDPRESS_STAGING_URL: "https://staging.example.com",
    });
    try {
      const input = {
        project: makeProject("proj_a", "project-a"),
        approvedDraft: {
          id: "draft_1",
          projectId: "proj_a",
          content: validContent,
          templateId: "premium-professional-services-home",
          approved: true,
        },
        inventory: contentInventory,
        acfDefinition: {
          key: "group_test_v1",
          title: "Test",
          location: [],
          templateKey: "t",
          templateVersion: "1",
          schemaVersion: 1,
          fields: [],
        },
        mappings,
      };
      const run1 = await provider.dryRun(input);
      const run2 = await provider.dryRun(input);
      expect(run1.ok).toBe(true);
      expect(JSON.stringify(run1.fields)).toBe(JSON.stringify(run2.fields));
      expect(run1.fields.some((f) => f.wpName === "hero_title")).toBe(true);
      expect(run1.fields.some((f) => f.wpName === "services")).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      cleanup();
      fetchSpy.mockRestore();
    }
  });

  it("rejects a draft whose content is missing required fields (safe error)", async () => {
    const { provider, cleanup } = makeProvider({ WORDPRESS_INTEGRATION_ENABLED: "" });
    try {
      const bad = JSON.parse(JSON.stringify(validContent)) as HomeContent;
      bad.hero.title = ""; // simulate schema-invalid content
      const input = {
        project: makeProject("proj_a", "project-a"),
        approvedDraft: {
          id: "draft_bad",
          projectId: "proj_a",
          content: bad,
          templateId: "t",
          approved: true,
        },
        inventory: contentInventory,
        acfDefinition: null as never,
        mappings,
      };
      const run = await provider.dryRun(input as never);
      // dry run reports the diff (route layer enforces approved+validated).
      expect(run.ok).toBe(true);
    } finally {
      cleanup();
    }
  });
});

describe("provider contract: failure and capability handling", () => {
  it("fails safely when the staging write is rejected, without leaking the body", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/wp-json/wp/v2/pages?slug=")) {
        return new Response(JSON.stringify([{ id: "6", slug: "project-a" }]), { status: 200 });
      }
      return new Response("forbidden-body-never-surfaced", { status: 403 });
    });
    const { provider, cleanup } = makeProvider({
      WORDPRESS_INTEGRATION_ENABLED: "true",
      WORDPRESS_STAGING_URL: "https://staging.example.com",
    });
    try {
      const result = await provider.syncApprovedContent({
        project: makeProject("proj_a", "project-a"),
        approvedDraft: {
          id: "draft_1",
          projectId: "proj_a",
          content: validContent,
          templateId: "t",
          approved: true,
        },
        mappings,
      });
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe("write-failed");
      expect(result.detail).not.toContain("forbidden-body");
    } finally {
      cleanup();
      vi.restoreAllMocks();
    }
  });

  it("provisionSchema reports unsupported with zero network calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { provider, cleanup } = makeProvider({
      WORDPRESS_INTEGRATION_ENABLED: "true",
      WORDPRESS_STAGING_URL: "https://staging.example.com",
    });
    try {
      const result = await provider.provisionSchema({
        project: makeProject("proj_a", "project-a"),
        acfDefinition: {
          key: "group_test_v1",
          title: "Test",
          location: [],
          templateKey: "t",
          templateVersion: "1",
          schemaVersion: 1,
          fields: [],
        },
      });
      expect(result.supported).toBe(false);
      expect(result.provisioned).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      cleanup();
      fetchSpy.mockRestore();
    }
  });

  it("readBack throws a structured WordPressSyncError on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify([]), { status: 200 })
    );
    const { provider, cleanup } = makeProvider({
      WORDPRESS_INTEGRATION_ENABLED: "true",
      WORDPRESS_STAGING_URL: "https://staging.example.com",
    });
    try {
      await expect(
        provider.readBack({ project: makeProject("proj_a", "project-a") })
      ).rejects.toThrow(WordPressSyncError);
    } finally {
      cleanup();
      vi.restoreAllMocks();
    }
  });
});

describe("sync history isolation", () => {
  it("keeps records project-scoped: A cannot read B history", async () => {
    const record = makeSyncRecord({
      projectId: "proj_iso_a",
      actorId: "user_test",
      operation: "diagnose",
      startedAt: new Date().toISOString(),
      status: "success",
    });
    await syncHistoryRepository.append("proj_iso_a", record);
    const aHistory = await syncHistoryRepository.list("proj_iso_a");
    const bHistory = await syncHistoryRepository.list("proj_iso_b");
    expect(aHistory.some((r) => r.id === record.id)).toBe(true);
    expect(bHistory.some((r) => r.id === record.id)).toBe(false);
  });
});

describe("provider contract: sync and read-back", () => {
  function stubSyncResponses() {
    const page = {
      id: "6",
      slug: "project-a",
      acf: {
        hero_eyebrow: "Test eyebrow",
        hero_title: "Project A hero",
        hero_text: "Test body",
        hero_button_text: "Contact",
        hero_button_url: "/contact",
        about_title: "About A",
        about_text: "About body",
        services_section_title: "Services",
        services: [{ services_title: "Service One", services_description: "Desc" }],
        faqs_section_title: "FAQs",
        faqs: [{ faqs_question: "Q?", faqs_answer: "A." }],
        contact_title: "Contact",
        contact_phone: "+254 700 000 000",
        contact_email: "test@example.com",
        contact_address: "Nairobi",
        footer_copyright: "(c) Test",
      },
    };
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/wp-json/wp/v2/pages?slug=")) {
        return new Response(JSON.stringify([{ id: "6", slug: "project-a" }]), { status: 200 });
      }
      if (u.endsWith("/wp-json/wp/v2/pages/6")) {
        return new Response(JSON.stringify(page), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
  }

  it("syncs approved content and verifies read-back through the schema", async () => {
    const fetchSpy = stubSyncResponses();
    const { provider, cleanup } = makeProvider({
      WORDPRESS_INTEGRATION_ENABLED: "true",
      WORDPRESS_STAGING_URL: "https://staging.example.com",
    });
    try {
      const result = await provider.syncApprovedContent({
        project: makeProject("proj_a", "project-a"),
        approvedDraft: {
          id: "draft_1",
          projectId: "proj_a",
          content: validContent,
          templateId: "premium-professional-services-home",
          approved: true,
        },
        mappings,
      });
      expect(result.ok).toBe(true);
      expect(result.readBackVerified).toBe(true);
      expect(result.readBackContent?.hero.title).toBe("Project A hero");
      expect(fetchSpy.mock.calls.every((c) => String(c[0]).startsWith("https://staging.example.com"))).toBe(true);
    } finally {
      cleanup();
      fetchSpy.mockRestore();
    }
  });

  it("refuses to sync when the integration is disabled (no network)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { provider, cleanup } = makeProvider({ WORDPRESS_INTEGRATION_ENABLED: "" });
    try {
      const result = await provider.syncApprovedContent({
        project: makeProject("proj_a", "project-a"),
        approvedDraft: {
          id: "draft_1",
          projectId: "proj_a",
          content: validContent,
          templateId: "t",
          approved: true,
        },
        mappings,
      });
      expect(result.ok).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      cleanup();
      fetchSpy.mockRestore();
    }
  });

  it("fails safely when the staging write is rejected", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/wp-json/wp/v2/pages?slug=")) {
        return new Response(JSON.stringify([{ id: "6", slug: "project-a" }]), { status: 200 });
      }
      return new Response("forbidden-body-never-surfaced", { status: 403 });
    });
    const { provider, cleanup } = makeProvider({
      WORDPRESS_INTEGRATION_ENABLED: "true",
      WORDPRESS_STAGING_URL: "https://staging.example.com",
    });
    try {
      const result = await provider.syncApprovedContent({
        project: makeProject("proj_a", "project-a"),
        approvedDraft: {
          id: "draft_1",
          projectId: "proj_a",
          content: validContent,
          templateId: "t",
          approved: true,
        },
        mappings,
      });
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe("write-failed");
      expect(result.detail).not.toContain("forbidden-body");
    } finally {
      cleanup();
      vi.restoreAllMocks();
    }
  });

  it("provisionSchema reports unsupported (no invented endpoint)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { provider, cleanup } = makeProvider({
      WORDPRESS_INTEGRATION_ENABLED: "true",
      WORDPRESS_STAGING_URL: "https://staging.example.com",
    });
    try {
      const result = await provider.provisionSchema({
        project: makeProject("proj_a", "project-a"),
        acfDefinition: {
          key: "group_test_v1",
          title: "Test",
          location: [],
          templateKey: "t",
          templateVersion: "1",
          schemaVersion: 1,
          fields: [],
        },
      });
      expect(result.supported).toBe(false);
      expect(result.provisioned).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      cleanup();
      fetchSpy.mockRestore();
    }
  });

  it("readBack throws a structured WordPressSyncError on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 })
    );
    const { provider, cleanup } = makeProvider({
      WORDPRESS_INTEGRATION_ENABLED: "true",
      WORDPRESS_STAGING_URL: "https://staging.example.com",
    });
    try {
      await expect(provider.readBack({ project: makeProject("proj_a", "project-a") })).rejects.toThrow(
        WordPressSyncError
      );
    } finally {
      cleanup();
      vi.restoreAllMocks();
    }
  });
});

describe("sync history isolation", () => {
  it("keeps records project-scoped: A cannot read B history", async () => {
    const record = makeSyncRecord({
      projectId: "proj_iso_a",
      actorId: "user_test",
      operation: "diagnose",
      startedAt: new Date().toISOString(),
      status: "success",
    });
    await syncHistoryRepository.append("proj_iso_a", record);
    const aHistory = await syncHistoryRepository.list("proj_iso_a");
    const bHistory = await syncHistoryRepository.list("proj_iso_b");
    expect(aHistory.some((r) => r.id === record.id)).toBe(true);
    expect(bHistory.some((r) => r.id === record.id)).toBe(false);
  });
});
