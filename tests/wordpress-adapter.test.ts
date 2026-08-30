import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  mapWordPressHome,
  normalizeImage,
  getHomeContent,
  resetLastKnownGood,
} from "@/lib/content/wordpress";
import { validateHomeContent } from "@/lib/content/validate";
import { wordpressSampleResponse } from "@/content/wordpress-sample";
import { homeFixture } from "@/content/home.fixture";

describe("mapWordPressHome (pure adapter)", () => {
  it("maps acf.hero_title to hero.title", () => {
    const mapped = mapWordPressHome(wordpressSampleResponse);
    expect(mapped.hero.title).toBe("Powering Kenya's modern digital service sectors");
  });

  it("maps acf.hero_text to hero.body and hero_button_url to hero.primaryCta.href", () => {
    const mapped = mapWordPressHome(wordpressSampleResponse);
    expect(mapped.hero.body).toBe(
      "We engineer enterprise systems, APIs, and client-facing interfaces that work smoothly even in challenging bandwidth environments."
    );
    expect(mapped.hero.primaryCta.href).toBe("/contact");
  });

  it("normalizes a WordPress image object shape", () => {
    const mapped = mapWordPressHome(wordpressSampleResponse);
    expect(mapped.hero.image).toEqual({
      url: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80",
      alt: "A high tech abstract background representing cloud systems",
    });
  });

  it("normalizes a raw string image URL", () => {
    const mapped = mapWordPressHome({
      acf: { hero_image: "https://example.com/photo.jpg" },
    });
    expect(mapped.hero.image).toEqual({
      url: "https://example.com/photo.jpg",
      alt: "",
    });
  });

  it("returns null for an empty or missing image", () => {
    expect(normalizeImage(null)).toBeNull();
    expect(normalizeImage(undefined)).toBeNull();
    expect(normalizeImage("")).toBeNull();
    expect(normalizeImage({})).toBeNull();
  });

  it("falls back to the image title when alt is missing", () => {
    expect(
      normalizeImage({ url: "https://example.com/x.jpg", title: "A title" })
    ).toEqual({ url: "https://example.com/x.jpg", alt: "A title" });
  });

  it("assigns stable IDs to services and FAQs when rows lack ids", () => {
    const mapped = mapWordPressHome(wordpressSampleResponse);
    expect(mapped.services.items.map((s) => s.id)).toEqual([
      "wp_srv_1",
      "wp_srv_2",
    ]);
    expect(mapped.faqs.items.map((f) => f.id)).toEqual(["wp_faq_1", "wp_faq_2"]);

    // Deterministic: mapping the same input twice yields identical IDs.
    const again = mapWordPressHome(wordpressSampleResponse);
    expect(again).toEqual(mapped);
  });

  it("preserves supplied repeater row IDs", () => {
    const mapped = mapWordPressHome({
      acf: {
        services: [
          { id: "custom_1", services_title: "A", services_description: "D" },
        ],
      },
    });
    expect(mapped.services.items[0].id).toBe("custom_1");
  });

  it("does NOT default a missing required hero title to generic copy", () => {
    const raw = {
      acf: {
        // hero_title missing entirely
        hero_text: "Body copy",
        hero_button_text: "Contact",
        hero_button_url: "/contact",
        about_title: "About",
        about_text: "About body",
        services_section_title: "Services",
        faqs_section_title: "FAQs",
        contact_title: "Contact",
        contact_phone: "+254 700 000 000",
        contact_email: "hello@example.com",
        footer_copyright: "© 2026",
      },
    };
    const mapped = mapWordPressHome(raw);
    expect(mapped.hero.title).toBe("");
    const validation = validateHomeContent(mapped);
    expect(validation.success).toBe(false);
  });

  it("does NOT default a missing required contact email", () => {
    const raw = {
      acf: {
        hero_title: "Title",
        hero_text: "Body",
        hero_button_text: "Contact",
        hero_button_url: "/contact",
        about_title: "About",
        about_text: "About body",
        services_section_title: "Services",
        faqs_section_title: "FAQs",
        contact_title: "Contact",
        contact_phone: "+254 700 000 000",
        // contact_email missing
        footer_copyright: "© 2026",
      },
    };
    const mapped = mapWordPressHome(raw);
    const validation = validateHomeContent(mapped);
    expect(validation.success).toBe(false);
  });

  it("keeps raw WordPress types out of the mapped output", () => {
    const mapped = mapWordPressHome(wordpressSampleResponse);
    // The mapped object must contain only internal schema keys.
    expect(Object.keys(mapped).sort()).toEqual(
      ["about", "contact", "faqs", "footer", "hero", "services"].sort()
    );
  });
});

describe("getHomeContent fallback policy", () => {
  beforeEach(() => {
    resetLastKnownGood();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns the fixture in development when WordPress is not configured", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WORDPRESS_API_URL", "");
    const result = await getHomeContent();
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.source).toBe("fixture");
      expect(result.content).toEqual(homeFixture);
    }
  });

  it("returns the fixture when PREVIEW_MODE=true even outside development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PREVIEW_MODE", "true");
    const result = await getHomeContent();
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.source).toBe("fixture");
    }
  });

  it("fails with a branded configuration error in production without WordPress config", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PREVIEW_MODE", "");
    vi.stubEnv("WORDPRESS_API_URL", "");
    const result = await getHomeContent();
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("Haipa Labs configuration error");
    }
  });

  it("fails (no fixture) when configured WordPress returns invalid required content in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PREVIEW_MODE", "");
    vi.stubEnv("WORDPRESS_API_URL", "https://example.com");
    resetLastKnownGood();

    const invalidPage = {
      acf: {
        // Required fields missing → validation must fail
        hero_eyebrow: "eyebrow",
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(invalidPage),
      })
    );

    const result = await getHomeContent();
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("validation");
    }
    // Crucially, the fictional fixture must NOT be returned.
    if (result.status === "ok") {
      expect(result.content).not.toEqual(homeFixture);
    }
  });

  it("serves the last-known-good snapshot when WordPress later fails", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WORDPRESS_API_URL", "https://example.com");
    resetLastKnownGood();

    const validPage = wordpressSampleResponse;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(validPage),
      })
    );

    const first = await getHomeContent();
    expect(first.status).toBe("ok");
    if (first.status === "ok") expect(first.source).toBe("wordpress");

    // Now WordPress fails
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      })
    );

    const second = await getHomeContent();
    expect(second.status).toBe("ok");
    if (second.status === "ok" && first.status === "ok") {
      expect(second.source).toBe("last-known-good");
      expect(second.content).toEqual(first.content);
    }
  });
});