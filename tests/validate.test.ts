import { describe, it, expect } from "vitest";
import { HomeContentSchema } from "@/types/content";
import { homeFixture } from "@/content/home.fixture";
import { validateHomeContent } from "@/lib/content/validate";
import { mapWordPressHome } from "@/lib/content/wordpress";
import { wordpressSampleResponse } from "@/content/wordpress-sample";

describe("HomeContentSchema validation", () => {
  it("accepts the valid local fixture", () => {
    const result = validateHomeContent(homeFixture);
    expect(result.success).toBe(true);
  });

  it("accepts the mapped WordPress sample response", () => {
    const mapped = mapWordPressHome(wordpressSampleResponse);
    const result = validateHomeContent(mapped);
    expect(result.success).toBe(true);
  });

  it("rejects an oversized hero title with a path-specific error", () => {
    const bad = {
      ...homeFixture,
      hero: { ...homeFixture.hero, title: "x".repeat(121) },
    };
    const result = validateHomeContent(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.details.some((d) => d.includes("hero.title"))).toBe(true);
    }
  });

  it("rejects a malformed contact email with a path-specific error", () => {
    const bad = {
      ...homeFixture,
      contact: { ...homeFixture.contact, email: "not-an-email" },
    };
    const result = validateHomeContent(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.details.some((d) => d.includes("contact.email"))).toBe(true);
    }
  });

  it("rejects an invalid hero image URL", () => {
    const bad = {
      ...homeFixture,
      hero: {
        ...homeFixture.hero,
        image: { url: "not-a-url", alt: "broken" },
      },
    };
    const result = validateHomeContent(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.details.some((d) => d.includes("hero.image.url"))).toBe(true);
    }
  });

  it("rejects more than 12 services", () => {
    const items = Array.from({ length: 13 }, (_, i) => ({
      id: `srv_${i}`,
      title: `Service ${i}`,
      description: "Description",
    }));
    const bad = {
      ...homeFixture,
      services: { ...homeFixture.services, items },
    };
    expect(HomeContentSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a missing required hero title (empty string)", () => {
    const bad = {
      ...homeFixture,
      hero: { ...homeFixture.hero, title: "" },
    };
    const result = validateHomeContent(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.details.some((d) => d.includes("hero.title"))).toBe(true);
    }
  });

  it("rejects a missing required contact email", () => {
    const bad = {
      ...homeFixture,
      contact: { ...homeFixture.contact, email: "" },
    };
    const result = validateHomeContent(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.details.some((d) => d.includes("contact.email"))).toBe(true);
    }
  });

  it("allows optional fields (eyebrow, address) to be empty", () => {
    const ok = {
      ...homeFixture,
      hero: { ...homeFixture.hero, eyebrow: "" },
      contact: { ...homeFixture.contact, address: "" },
    };
    const result = validateHomeContent(ok);
    expect(result.success).toBe(true);
  });
});