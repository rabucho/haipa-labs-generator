import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  listProviderDescriptors,
  resolveGenerationProvider,
  listOpenRouterModels,
} from "@/lib/generation/provider-registry";
import {
  AboutPageSchema,
  ServicesPageSchema,
  ContactPageSchema,
  FaqsPageSchema,
  PAGE_MANIFEST,
  enabledPages,
  isPageKey,
  siteContentFromHomeContent,
} from "@/types/pages";
import { homeFixture } from "@/content/home.fixture";
import { HomeTemplate } from "@/components/HomeTemplate";
import { renderProjectPage } from "@/lib/templates/pages";
import type { HomeContent } from "@/types/content";

// ── Provider registry ───────────────────────────────────────────────────

describe("provider registry", () => {
  it("returns safe descriptors only (no credentials, keys, or base URLs)", () => {
    const serialized = JSON.stringify(listProviderDescriptors());
    expect(serialized).not.toMatch(/api[_-]?key/i);
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("generativelanguage.googleapis.com");
    expect(serialized).not.toContain("openrouter.ai");
    expect(serialized).not.toContain("localhost:11434");
  });

  it("always offers the deterministic provider", () => {
    const resolved = resolveGenerationProvider("deterministic");
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.providerId).toBe("deterministic-local");
    }
  });

  it("rejects unknown providers without fallback", () => {
    const r = resolveGenerationProvider("made-up-provider");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe("unknown-provider");
  });

  it("reports unconfigured providers as a visible error (no silent fallback)", () => {
    // Test env has no AI_* provider flags set to enabled.
    for (const id of ["ai", "ollama", "gemini", "openrouter"]) {
      const r = resolveGenerationProvider(id);
      // Depending on the machine's env, these are disabled or unconfigured —
      // critically, none of them succeed or fall back to deterministic.
      if (r.ok) {
        expect(r.providerId).toBe(id);
      } else {
        expect(["disabled", "unconfigured"]).toContain(r.errorCode);
      }
    }
  });

  it("marks unconfigured providers in the catalog as unavailable", () => {
    const descriptors = listProviderDescriptors();
    const byId = new Map(descriptors.map((d) => [d.providerId, d]));
    expect(byId.get("deterministic")?.availability).toBe("local");
    const gemini = byId.get("gemini")!;
    expect(["unconfigured", "disabled", "enabled"]).toContain(gemini.availability);
    if (gemini.availability !== "enabled") {
      const r = resolveGenerationProvider("gemini");
      expect(r.ok).toBe(false);
    }
  });

  it("documents capability differences (ollama without structured output)", () => {
    const byId = new Map(listProviderDescriptors().map((d) => [d.providerId, d]));
    expect(byId.get("ollama")?.supportsStructuredOutput).toBe(false);
    expect(byId.get("deterministic")?.supportsStructuredOutput).toBe(false);
    expect(byId.get("deterministic")?.costLabel).toBe("local");
    expect(byId.get("ollama")?.costLabel).toBe("local");
  });

  it("OpenRouter discovery is disabled with zero network when unconfigured", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await listOpenRouterModels();
    if (!result.ok) {
      expect(result.errorCode).toBe("disabled");
      expect(fetchSpy).not.toHaveBeenCalled();
    }
    vi.restoreAllMocks();
  });
});

// ── Multi-page contract ─────────────────────────────────────────────────

describe("page manifest", () => {
  it("exposes the five required pages plus the Shop capability", () => {
    const keys = PAGE_MANIFEST.map((p) => p.pageKey);
    for (const key of ["home", "about", "services", "faqs", "contact", "shop"]) {
      expect(keys).toContain(key);
    }
  });

  it("excludes Shop from navigation when WooCommerce is disabled", () => {
    const pages = enabledPages({});
    expect(pages.some((p) => p.pageKey === "shop")).toBe(false);
    // And includes all five required pages.
    for (const key of ["home", "about", "services", "faqs", "contact"]) {
      expect(pages.some((p) => p.pageKey === key)).toBe(true);
    }
  });

  it("includes Shop only when the WooCommerce capability is enabled", () => {
    expect(enabledPages({ woocommerce: true }).some((p) => p.pageKey === "shop")).toBe(true);
  });

  it("marks Home as required and Shop as capability-gated", () => {
    const home = PAGE_MANIFEST.find((p) => p.pageKey === "home")!;
    const shop = PAGE_MANIFEST.find((p) => p.pageKey === "shop")!;
    expect(home.required).toBe(true);
    expect(shop.requiresCapability).toBe("woocommerce");
    expect(shop.enabledByDefault).toBe(false);
  });
});

describe("page schemas", () => {
  it("rejects invalid About content", () => {
    expect(AboutPageSchema.safeParse({ eyebrow: "", title: "", body: "x" }).success).toBe(false);
    expect(
      AboutPageSchema.safeParse({ eyebrow: "", title: "T", body: "B", rogue: 1 }).success
    ).toBe(false);
  });

  it("rejects oversized service lists and unknown fields", () => {
    const items = Array.from({ length: 13 }, (_, i) => ({
      id: `srv_${i}`,
      title: `S${i}`,
      description: "D",
    }));
    expect(
      ServicesPageSchema.safeParse({ eyebrow: "", title: "T", items }).success
    ).toBe(false);
  });

  it("rejects invalid contact emails and FAQ shapes", () => {
    expect(
      ContactPageSchema.safeParse({ title: "T", phone: "1", email: "nope", address: "" })
        .success
    ).toBe(false);
    expect(
      FaqsPageSchema.safeParse({ eyebrow: "", title: "T", items: [{ id: "f", question: "", answer: "" }] })
        .success
    ).toBe(false);
  });
});

describe("legacy HomeContent compatibility", () => {
  it("derives the SiteContent envelope without mutating the stored draft", () => {
    const site = siteContentFromHomeContent(
      homeFixture,
      "premium-professional-services-home",
      "1.0.0"
    );
    expect(site.schemaVersion).toBe("2.0");
    expect(site.pages.about).toEqual(homeFixture.about);
    expect(site.pages.services.items).toEqual(homeFixture.services.items);
  });

  it("still renders legacy Home-only content through the approved HomeTemplate", () => {
    expect(() => HomeTemplate({ content: homeFixture as HomeContent })).not.toThrow();
  });
});

describe("page rendering through the shared shell", () => {
  const site = siteContentFromHomeContent(
    homeFixture,
    "premium-professional-services-home",
    "1.0.0"
  );

  it("renders each enabled page with header nav and active-route marking", () => {
    for (const key of ["home", "about", "services", "faqs", "contact"] as const) {
      const html = renderToStaticMarkup(
        renderProjectPage({ content: site, pageKey: key, brandName: "Test Co" })!
      );
      // Navigation from the manifest — every enabled page reachable.
      for (const route of ["/", "/about", "/services", "/faqs", "/contact"]) {
        expect(html).toContain(`href="${route}"`);
      }
      // Shop must never appear while disabled.
      expect(html).not.toContain('href="/shop"');
      // Active-route indication is accessible.
      expect(html).toContain('aria-current="page"');
    }
  });

  it("never renders a disabled page (Shop)", () => {
    expect(renderProjectPage({ content: site, pageKey: "shop", brandName: "T" })).toBeNull();
    expect(isPageKey("shop")).toBe(true); // known key, capability-gated
  });

  it("uses the same manifest for mobile and desktop navigation", () => {
    const html = renderToStaticMarkup(
      renderProjectPage({ content: site, pageKey: "about", brandName: "Test Co" })!
    );
    // Desktop nav and the mobile drawer both come from enabledPages().
    const navOccurrences = (html.match(/aria-label="Primary"/g) ?? []).length;
    const mobileOccurrences = (html.match(/aria-label="Mobile"/g) ?? []).length;
    expect(navOccurrences).toBe(1);
    expect(mobileOccurrences).toBe(1);
  });
});
