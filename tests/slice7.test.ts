import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync, rmSync } from "fs";
import { join } from "path";
import {
  AiHomeContentSchema,
  mapAiResponseToHomeContent,
  parseAiJsonResponse,
} from "@/lib/generation/ai-content-schema";
import {
  serverAiProvider,
  AI_CONTENT_PROMPT_VERSION,
} from "@/lib/generation/ai-provider";
import { getAiGenerationConfig } from "@/lib/generation/config";
import {
  deterministicProvider,
  computeInputHash,
} from "@/lib/generation/deterministic-provider";
import {
  GenerationAuditSchema,
  JsonFileGenerationAuditRepository,
} from "@/lib/generation/audit";
import { contentInventory } from "@/content/content-inventory";
import { getReadyTemplate } from "@/lib/templates/registry";
import { HomeContentSchema } from "@/types/content";
import { HomeTemplate } from "@/components/HomeTemplate";

const dataDir = join(process.cwd(), ".slice7-test-data");
process.env.PROJECTS_DATA_DIR = dataDir;

const template = getReadyTemplate("premium-professional-services-home")!;

const input = {
  project: { id: "proj_ai", name: "Amani Solar", slug: "amani-solar", industry: "renewable energy" },
  brief: {
    businessName: "Amani Solar Ltd",
    industry: "renewable energy",
    offer: "Commercial solar installation and maintenance.",
    contactDetails: { phone: "+254 700 111 222", email: "hello@amanisolar.co.ke" },
  },
  media: [
    {
      id: "media_1",
      kind: "photo" as const,
      name: "Hero",
      sourceUrl: "https://images.example.com/hero.jpg",
      altText: "Solar panels",
      approved: true,
    },
  ],
  template,
  inventory: contentInventory,
};

const projectRepo = new (await import("@/lib/projects/project-repository"))
  .JsonFileProjectRepository();
const draftRepo = new (await import("@/lib/projects/draft-repository"))
  .JsonFileProjectDraftRepository();
const auditRepo = new JsonFileGenerationAuditRepository();

function validAiJson(overrides: Record<string, unknown> = {}): string {
  const body = {
    hero: {
      eyebrow: "renewable energy",
      title: "Amani Solar Ltd: Commercial solar installation",
      body: "We install and maintain commercial solar systems for factories.",
      primaryCta: { label: "Get in touch", href: "#contact" },
      image: { url: "https://images.example.com/hero.jpg", alt: "Solar panels" },
    },
    about: {
      eyebrow: "Serving Nairobi",
      title: "About Amani Solar Ltd",
      body: "Who this is for: facilities managers. Commercial solar installation and maintenance.",
    },
    services: {
      eyebrow: "What we do",
      title: "Services",
      items: [
        { title: "Commercial solar installation", description: "Turnkey rooftop systems for factories." },
        { title: "Panel maintenance", description: "Scheduled cleaning and performance checks." },
      ],
    },
    faqs: {
      eyebrow: "Questions",
      title: "Frequently asked questions",
      items: [
        { question: "How can I contact Amani Solar Ltd?", answer: "[For review] Confirm contact channel." },
      ],
    },
    contact: {
      title: "Contact Amani Solar Ltd",
      phone: "+254 700 111 222",
      email: "hello@amanisolar.co.ke",
      address: "",
    },
    footer: { copyright: "© 2026 Amani Solar Ltd" },
  };
  return JSON.stringify({ ...body, ...overrides });
}

function aiFetchResponse(raw: string) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        choices: [{ message: { content: raw } }],
        usage: { prompt_tokens: 100, completion_tokens: 200 },
      }),
  };
}

beforeEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  vi.stubEnv("AI_GENERATION_ENABLED", "true");
  vi.stubEnv("AI_MODEL", "test-model-1");
  vi.stubEnv("AI_API_KEY", "sk-test-SECRET");
  vi.stubEnv("AI_BASE_URL", "https://fake.local/v1");
  vi.stubEnv("AI_MAX_RETRIES", "2");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AI configuration and safety gate", () => {
  it("is disabled safely when the feature flag is false", () => {
    vi.stubEnv("AI_GENERATION_ENABLED", "false");
    expect(getAiGenerationConfig().enabled).toBe(false);
  });

  it("reads provider and model configuration from server-side env vars", () => {
    const config = getAiGenerationConfig();
    expect(config.provider).toBe("openai-compatible");
    expect(config.model).toBe("test-model-1");
    expect(config.maxRetries).toBe(2);
    expect(JSON.stringify(config)).not.toContain("sk-test-SECRET");
  });

  it("the real provider refuses to run when disabled", async () => {
    vi.stubEnv("AI_GENERATION_ENABLED", "false");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(serverAiProvider.generateWebsiteDraft(input)).rejects.toThrow(/disabled/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("no client component imports the server-only AI modules", () => {
    const srcDir = join(process.cwd(), "src");
    function listFiles(dir: string): string[] {
      return readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return listFiles(full);
        return [full];
      });
    }
    const offenders: string[] = [];
    for (const file of listFiles(srcDir)) {
      if (!file.endsWith(".tsx") && !file.endsWith(".ts")) continue;
      const source = readFileSync(file, "utf-8");
      const isClient = /^["']use client["']/m.test(source);
      if (isClient && /@\/lib\/generation\/(ai-provider|config|audit)/.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("AI response parsing, validation, and normalization", () => {
  it("parses a valid structured provider response into valid HomeContent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(aiFetchResponse(validAiJson())));
    const result = await serverAiProvider.generateWebsiteDraft(input);
    expect(result.metadata.provider).toBe("ai");
    expect(result.metadata.model).toBe("test-model-1");
    expect(result.metadata.promptVersion).toBe(AI_CONTENT_PROMPT_VERSION);
    expect(result.content.hero.title).toContain("Amani Solar Ltd");
  });

  it("rejects malformed JSON safely", () => {
    expect(() => parseAiJsonResponse("not json at all {")).toThrow();
  });

  it("rejects extra JSON properties (strict schema)", () => {
    const withExtra = JSON.parse(validAiJson()) as Record<string, unknown>;
    withExtra.sneaky = "<script>alert(1)</script>";
    expect(AiHomeContentSchema.safeParse(withExtra).success).toBe(false);
  });

  it("rejects schema-invalid output (empty hero title)", () => {
    const bad = JSON.parse(validAiJson());
    bad.hero.title = "";
    expect(AiHomeContentSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects executable/HTML content in text fields", () => {
    const bad = JSON.parse(validAiJson());
    bad.hero.title = "<script>alert(1)</script>";
    expect(AiHomeContentSchema.safeParse(bad).success).toBe(false);
  });

  it("normalizes image references: only approved https URLs survive", () => {
    const ai = AiHomeContentSchema.parse(JSON.parse(validAiJson()));
    expect(mapAiResponseToHomeContent(ai, input).hero.image?.url).toBe(
      "https://images.example.com/hero.jpg"
    );
    const unapproved = JSON.parse(validAiJson());
    unapproved.hero.image = { url: "https://evil.example.com/x.jpg", alt: "x" };
    expect(
      mapAiResponseToHomeContent(AiHomeContentSchema.parse(unapproved), input).hero.image
    ).toBeNull();
    const nulled = JSON.parse(validAiJson());
    nulled.hero.image = null;
    expect(
      mapAiResponseToHomeContent(AiHomeContentSchema.parse(nulled), input).hero.image
    ).toBeNull();
  });

  it("contact details come only from the brief; invented ones are replaced", () => {
    const ai = AiHomeContentSchema.parse(JSON.parse(validAiJson()));
    const mapped = mapAiResponseToHomeContent(ai, input);
    expect(mapped.contact.phone).toBe("+254 700 111 222");
    expect(mapped.contact.email).toBe("hello@amanisolar.co.ke");
    const noContact = { ...input, brief: { ...input.brief, contactDetails: undefined } };
    const mapped2 = mapAiResponseToHomeContent(ai, noContact);
    expect(mapped2.contact.phone).toContain("For review");
    expect(mapped2.contact.email).toBe("review-needed@example.invalid");
  });

  it("CTA href is restricted to #contact or the brief's own website", () => {
    const ai = AiHomeContentSchema.parse(JSON.parse(validAiJson()));
    const evil = {
      ...ai,
      hero: { ...ai.hero, primaryCta: { label: "x", href: "https://evil.example.com" } },
    };
    expect(mapAiResponseToHomeContent(evil, input).hero.primaryCta.href).toBe("#contact");
  });

  it("input-size limits reject oversized payloads clearly", async () => {
    vi.stubEnv("AI_MAX_INPUT_CHARS", "10");
    await expect(serverAiProvider.generateWebsiteDraft(input)).rejects.toThrow(
      /AI_MAX_INPUT_CHARS/
    );
  });

  it("canonical input hashing is stable and brief-sensitive", () => {
    const a = computeInputHash(input);
    expect(computeInputHash(input)).toBe(a);
    const otherBrief = { ...input, brief: { ...input.brief, businessName: "Other Biz" } };
    expect(computeInputHash(otherBrief)).not.toBe(a);
  });

  it("transient provider failures obey the retry limit, then a redacted error", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchSpy);
    await expect(serverAiProvider.generateWebsiteDraft(input)).rejects.toThrow(
      /status 500 \(redacted\)/
    );
    expect(fetchSpy).toHaveBeenCalledTimes(3); // 1 + AI_MAX_RETRIES(2)
  });

  it("credentials and raw responses are not logged and never returned", async () => {
    const logSpy = vi.spyOn(console, "log");
    const warnSpy = vi.spyOn(console, "warn");
    const errorSpy = vi.spyOn(console, "error");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(aiFetchResponse(validAiJson())));
    const result = await serverAiProvider.generateWebsiteDraft(input);
    expect(JSON.stringify(result)).not.toContain("sk-test-SECRET");
    for (const spy of [logSpy, warnSpy, errorSpy]) {
      for (const call of spy.mock.calls) {
        expect(String(call)).not.toContain("sk-test-SECRET");
      }
    }
  });

  it("renders the AI-mapped result through the existing HomeTemplate", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(aiFetchResponse(validAiJson())));
    const result = await serverAiProvider.generateWebsiteDraft(input);
    expect(() => HomeTemplate({ content: result.content })).not.toThrow();
  });
});

describe("draft lifecycle, audit, and review semantics", () => {
  it("successful AI generation creates a review draft and preserves the previous draft", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(aiFetchResponse(validAiJson())));
    const project = await projectRepo.createProject({
      name: "AI Draft Co", prospectName: "AIDC", industry: "tech", templateId: template.id,
    });
    const previous = await draftRepo.createDraft({
      projectId: project.id, templateId: template.id,
      content: (await deterministicProvider.generateWebsiteDraft(input)).content,
      source: "manual",
    });
    const result = await serverAiProvider.generateWebsiteDraft(input);
    const aiDraft = await draftRepo.createDraft({
      projectId: project.id, templateId: template.id, content: result.content,
      source: "ai",
      aiPromptVersion: `${result.metadata.promptVersion}#${result.metadata.inputHash}`,
    });
    expect(aiDraft.source).toBe("ai");
    expect(aiDraft.approved).toBe(false); // review — never auto-approved
    const drafts = await draftRepo.listDrafts(project.id);
    expect(drafts).toHaveLength(2);
    expect(drafts.find((d) => d.id === previous.id)).toBeTruthy();
  });

  it("AI generation never changes an approved project status automatically", async () => {
    const { statusAfterGeneration } = await import("@/lib/projects/status");
    expect(statusAfterGeneration("approved")).toBe("approved");
    expect(statusAfterGeneration("sold")).toBe("sold");
    expect(statusAfterGeneration("brief")).toBe("review");
  });

  it("failed AI generation preserves the previous draft", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(aiFetchResponse("BROKEN{{JSON")));
    const project = await projectRepo.createProject({
      name: "Fail Preserve", prospectName: "FP", industry: "tech", templateId: template.id,
    });
    const good = await draftRepo.createDraft({
      projectId: project.id, templateId: template.id,
      content: (await deterministicProvider.generateWebsiteDraft(input)).content,
      source: "manual",
    });
    await expect(serverAiProvider.generateWebsiteDraft(input)).rejects.toThrow();
    const drafts = await draftRepo.listDrafts(project.id);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].id).toBe(good.id);
  });

  it("approval records a redacted audit event; audit strips unknown fields", async () => {
    const project = await projectRepo.createProject({
      name: "Audit Co", prospectName: "AC", industry: "tech", templateId: template.id,
    });
    await auditRepo.append(project.id, {
      id: "audit_1", projectId: project.id, provider: "openai-compatible",
      model: "test-model-1", promptVersion: AI_CONTENT_PROMPT_VERSION,
      templateId: template.id, templateVersion: template.version,
      inputHash: "abcdef1234567890abcdef1234567890", status: "approved",
      startedAt: new Date().toISOString(), operator: "local-operator",
    });
    const events = await auditRepo.list(project.id);
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("approved");
    const parsed = GenerationAuditSchema.safeParse({
      ...events[0], rawPrompt: "SECRET PROMPT", apiKey: "sk-test-SECRET",
    });
    expect(parsed.success).toBe(true);
    expect(JSON.stringify(parsed.data)).not.toContain("SECRET");
  });

  it("rejection keeps the previous known-good draft; both remain loadable", async () => {
    const project = await projectRepo.createProject({
      name: "Reject Co", prospectName: "RC", industry: "tech", templateId: template.id,
    });
    const older = await draftRepo.createDraft({
      projectId: project.id, templateId: template.id,
      content: (await deterministicProvider.generateWebsiteDraft(input)).content,
      source: "manual",
    });
    const newer = await draftRepo.createDraft({
      projectId: project.id, templateId: template.id,
      content: (await deterministicProvider.generateWebsiteDraft(input)).content,
      source: "ai",
    });
    await draftRepo.setApproved(project.id, newer.id, false);
    const restored = await draftRepo.loadDraft(project.id, older.id);
    expect(restored?.content.hero.title).toBeTruthy();
    expect((await draftRepo.listDrafts(project.id)).length).toBe(2);
  });

  it("project isolation: project A cannot read project B's drafts or audit", async () => {
    const projectA = await projectRepo.createProject({
      name: "Iso A7", prospectName: "A", industry: "tech", templateId: template.id,
    });
    const projectB = await projectRepo.createProject({
      name: "Iso B7", prospectName: "B", industry: "tech", templateId: template.id,
    });
    await draftRepo.createDraft({
      projectId: projectA.id, templateId: template.id,
      content: (await deterministicProvider.generateWebsiteDraft(input)).content,
      source: "manual",
    });
    expect(await draftRepo.listDrafts(projectB.id)).toHaveLength(0);
    expect(await auditRepo.list(projectB.id)).toHaveLength(0);
  });
});

describe("section regeneration (Part H)", () => {
  it("changes only the requested section after validation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        aiFetchResponse(
          JSON.stringify({
            hero: {
              eyebrow: "renewable energy",
              title: "A REGENERATED hero title",
              body: "Regenerated hero body from the brief.",
              primaryCta: { label: "Get in touch", href: "#contact" },
              image: null,
            },
          })
        )
      )
    );
    const base = await deterministicProvider.generateWebsiteDraft(input);
    const result = await serverAiProvider.regenerateSection(input, "hero", base.content);
    const merged = HomeContentSchema.parse({ ...base.content, hero: result.section });
    expect(merged.hero.title).toBe("A REGENERATED hero title");
    expect(merged.about).toEqual(base.content.about);
    expect(merged.services).toEqual(base.content.services);
  });

  it("invalid section output leaves the existing section unchanged (throws)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(aiFetchResponse(JSON.stringify({ hero: { title: "" } })))
    );
    const base = await deterministicProvider.generateWebsiteDraft(input);
    await expect(
      serverAiProvider.regenerateSection(input, "hero", base.content)
    ).rejects.toThrow(/existing section is unchanged/);
  });

  it("rejects sections that are not eligible", async () => {
    const base = await deterministicProvider.generateWebsiteDraft(input);
    await expect(
      serverAiProvider.regenerateSection(input, "layout" as never, base.content)
    ).rejects.toThrow(/not eligible/);
  });
});

describe("deterministic provider remains available (Slice 7)", () => {
  it("works offline with no network calls", async () => {
    vi.stubEnv("AI_GENERATION_ENABLED", "false");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await deterministicProvider.generateWebsiteDraft(input);
    expect(result.metadata.provider).toBe("deterministic-local");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
