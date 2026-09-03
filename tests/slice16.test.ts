import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { rmSync } from "fs";
import { join } from "path";
import {
  BlankTemplateInputSchema,
  buildBlankDocument,
  BlankTemplateError,
} from "@/lib/templates/blank";
import {
  requestTemplateProposal,
  acceptProposal,
  rejectProposal,
  listProposals,
} from "@/lib/templates/proposals";
import { templateVersionStore } from "@/lib/templates/version-store";
import { templateFamilyStore } from "@/lib/templates/families";

const dataDir = join(process.cwd(), ".slice16-test-data");
beforeAll(() => {
  process.env.TEMPLATES_DATA_DIR = join(process.cwd(), ".slice16-templates");
  rmSync(dataDir, { recursive: true, force: true });
});

// ── Stage A: blank template creation ────────────────────────────────────

describe("blank template creation", () => {
  it("accepts a valid blank input", () => {
    const r = BlankTemplateInputSchema.safeParse({
      familyKey: "clinic-care",
      displayName: "Clinic Care",
      enabledPages: ["home", "about", "contact"],
    });
    expect(r.success).toBe(true);
  });

  it("builds a validated document with required sections per enabled page", async () => {
    const doc = buildBlankDocument({
      familyKey: "clinic-care",
      displayName: "Clinic Care",
      enabledPages: ["home", "about", "contact"],
      designTokens: { "--color-primary": "#0a7a5f" },
    });
    expect(doc.pages.find((p) => p.pageKey === "home")!.enabled).toBe(true);
    expect(doc.pages.find((p) => p.pageKey === "about")!.enabled).toBe(true);
    expect(doc.pages.find((p) => p.pageKey === "faqs")?.enabled ?? false).toBe(false);
    expect(doc.designTokens["--color-primary"]).toBe("#0a7a5f");
    expect(await validateBuilderDocumentShim(doc)).toEqual([]);
  });

  it("rejects a blank template without Home", () => {
    expect(() =>
      buildBlankDocument({
        familyKey: "no-home",
        displayName: "No Home",
        enabledPages: ["about", "contact"],
      })
    ).toThrow(BlankTemplateError);
  });

  it("gates Shop behind the WooCommerce capability", () => {
    const prev = process.env.WOOCOMMERCE_ENABLED;
    process.env.WOOCOMMERCE_ENABLED = "";
    expect(() =>
      buildBlankDocument({
        familyKey: "shop-gated",
        displayName: "Shop Gated",
        enabledPages: ["home"],
        includeShop: true,
      })
    ).toThrow(/WooCommerce/);
    process.env.WOOCOMMERCE_ENABLED = prev;
  });

  it("rejects invalid token values", () => {
    const r = BlankTemplateInputSchema.safeParse({
      familyKey: "bad-tokens",
      displayName: "Bad",
      enabledPages: ["home"],
      designTokens: { "--color-primary": "purple" },
    });
    expect(r.success).toBe(false);
  });

  it("persists a blank draft with a content hash and family record", async () => {
    const created = await templateVersionStore.createFamilyDraft({
      familyKey: "blank-family",
      displayName: "Blank Family",
      document: buildBlankDocument({
        familyKey: "blank-family",
        displayName: "Blank Family",
        enabledPages: ["home", "about"],
      }),
      createdBy: "op-1",
    });
    expect(created.status).toBe("draft");
    const family = await templateFamilyStore.get("blank-family");
    expect(family?.displayName).toBe("Blank Family");
    expect(family?.versionIds).toContain(created.versionId);
  });

// ── Stage B–D: AI proposal lifecycle (stubbed provider) ────────────────

const validProposalOutput = {
  document: {
    templateVersion: "1.0.0",
    designTokens: { "--color-primary": "#123456" },
    pages: [
      {
        pageKey: "home",
        enabled: true,
        sections: [
          { instanceId: "p_hero", sectionType: "hero", order: 0 },
          { instanceId: "p_about", sectionType: "about", order: 1 },
        ],
      },
      {
        pageKey: "about",
        enabled: true,
        sections: [{ instanceId: "p_about2", sectionType: "about", order: 0 }],
      },
      {
        pageKey: "services",
        enabled: true,
        sections: [{ instanceId: "p_srv", sectionType: "services", order: 0 }],
      },
      {
        pageKey: "faqs",
        enabled: true,
        sections: [{ instanceId: "p_faq", sectionType: "faqs", order: 0 }],
      },
      {
        pageKey: "contact",
        enabled: true,
        sections: [{ instanceId: "p_contact", sectionType: "contact", order: 0 }],
      },
    ],
    siteShell: { headerVariant: "brand-left", footerVariant: "standard", navigationStyle: "inline" },
  },
  rationale: "Compact hero with a calm teal palette for professional services.",
};

function stubProposalResponse(output: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: JSON.stringify(output) } }],
        }),
    })
  );
}

function enableOpenRouter(model = "test/model") {
  vi.stubEnv("AI_OPENROUTER_ENABLED", "true");
  vi.stubEnv("AI_OPENROUTER_MODEL", model);
  vi.stubEnv("AI_OPENROUTER_API_KEY", "sk-test");
}

describe("AI template proposals (stubbed provider)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("creates a proposal_review artifact with provider/model metadata and hashes", async () => {
    enableOpenRouter();
    stubProposalResponse(validProposalOutput);
    const r = await requestTemplateProposal({
      displayName: "Test Proposal",
      industry: "Testing",
      requiredPages: ["home", "about", "services", "faqs", "contact"],
      providerId: "openrouter",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.proposal.status).toBe("proposal_review");
      expect(r.proposal.providerId).toBe("openrouter");
      expect(r.proposal.modelId).toBe("test/model");
      expect(r.proposal.promptVersion).toBe("template-proposal-v1");
      expect(r.proposal.inputHash).toBeTruthy();
      expect(r.proposal.outputHash).toBeTruthy();
    }
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain("sk-test");
  });

  it("rejects invalid output (unknown section type) without saving", async () => {
    enableOpenRouter();
    const bad = JSON.parse(JSON.stringify(validProposalOutput));
    bad.document.pages[0].sections[0].sectionType = "arbitrary-jsx";
    stubProposalResponse(bad);
    const r = await requestTemplateProposal({
      displayName: "Bad Output",
      requiredPages: ["home"],
      providerId: "openrouter",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe("invalid-output");
  });

  it("rejects disabled providers without fallback (no network)", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const r = await requestTemplateProposal({
      displayName: "No Provider",
      requiredPages: ["home"],
      providerId: "gemini",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(["provider-disabled", "unreachable"]).toContain(r.errorCode);
    expect(spy).not.toHaveBeenCalled();
  });

  it("gates openrouter/free as non-deterministic", async () => {
    enableOpenRouter("openrouter/free");
    const r = await requestTemplateProposal({
      displayName: "Free Router",
      requiredPages: ["home"],
      providerId: "openrouter",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/disabled|credential/i);
  });

  it("accept creates a NEW draft version; source/published versions unchanged", async () => {
    enableOpenRouter();
    stubProposalResponse(validProposalOutput);
    const request = await requestTemplateProposal({
      displayName: "Accept Proposal",
      requiredPages: ["home"],
      providerId: "openrouter",
    });
    expect(request.ok).toBe(true);
    if (!request.ok) return;

    const before = await templateVersionStore.list();
    const accepted = await acceptProposal(request.proposal.proposalId, "op-1");
    expect(accepted.ok).toBe(true);

    const after = await templateVersionStore.list();
    expect(after.length).toBe(before.length + 1);
    const newVersion = after.find(
      (v) => v.versionId === (accepted as { versionId: string }).versionId
    )!;
    expect(newVersion.status).toBe("draft"); // never published by AI
    expect(newVersion.document).toEqual(request.proposal.document);

    const again = await acceptProposal(request.proposal.proposalId, "op-1");
    expect(again.ok).toBe(false);
  });

  it("reject has no catalog side effect", async () => {
    enableOpenRouter();
    stubProposalResponse(validProposalOutput);
    const request = await requestTemplateProposal({
      displayName: "Reject Proposal",
      requiredPages: ["home"],
      providerId: "openrouter",
    });
    expect(request.ok).toBe(true);
    if (!request.ok) return;

    const before = await templateVersionStore.list();
    const rejected = await rejectProposal(request.proposal.proposalId);
    expect(rejected.ok).toBe(true);
    expect((await templateVersionStore.list()).length).toBe(before.length);
    const proposals = await listProposals();
    expect(
      proposals.find((p) => p.proposalId === request.proposal.proposalId)?.status
    ).toBe("rejected");
  });
});

// Shims the real validator via a dynamic import to keep the import list small.
async function validateBuilderDocumentShim(doc: unknown): Promise<string[]> {
  const { validateBuilderDocument } = await import("@/types/builder");
  return validateBuilderDocument(doc as never)
    .filter((i) => i.severity === "error")
    .map((i) => i.path);
}

});
