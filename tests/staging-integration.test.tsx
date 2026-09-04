import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { WordPressPageResponse } from "@/types/wordpress";
import { WordPressRestContentProvider } from "@/lib/content/provider";
import {
  mapWordPressHome,
  getHomeContent,
  resetLastKnownGood,
  describeAcfState,
  resolveHeroImage,
} from "@/lib/content/wordpress";
import { validateHomeContent } from "@/lib/content/validate";
import { homeFixture } from "@/content/home.fixture";
import { HomeTemplate } from "@/components/HomeTemplate";
import {
  getRevalidateSeconds,
  buildWordPressFetchOptions,
  getWordPressServerConfig,
  REVALIDATE_TAG,
} from "@/lib/content/server-config";

const fixturesDir = join(__dirname, "fixtures");
const samplePath = join(fixturesDir, "staging-home-page.sample.json");
const realCapturePath = join(fixturesDir, "staging-home-page.json");
const stagingConfig = {
  apiUrl: "https://staging.example.co.ke/wp-json",
  pageSlug: "home",
};

function loadCapture(path: string, label: string): WordPressPageResponse {
  const parsed = JSON.parse(readFileSync(path, "utf-8"));
  // A capture may be the raw REST list response ([{ page }, …]) or a single
  // page object — unwrap it the same way the production provider does.
  const page = Array.isArray(parsed) ? parsed[0] : parsed;
  if (page && typeof page === "object") {
    delete (page as Record<string, unknown>)._note;
  }
  expect(page, `${label} must contain a page object`).toBeTruthy();
  return page as WordPressPageResponse;
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return listFiles(full);
    return [full];
  });
}

describe("staging capture → valid HomeContent", () => {
  const sample = loadCapture(samplePath, "staging sample capture");

  it("maps the captured staging response into valid HomeContent", () => {
    const mapped = mapWordPressHome(sample);
    const validation = validateHomeContent(mapped);
    expect(validation.success).toBe(true);
  });

  it("also maps the operator's real staging capture when present", () => {
    if (!existsSync(realCapturePath)) {
      console.warn(
        "No real staging capture at tests/fixtures/staging-home-page.json yet — " +
          "complete docs/wordpress-staging-setup.md steps 5–8 to finish live verification."
      );
      return;
    }
    const real = loadCapture(realCapturePath, "real staging capture");
    const mapped = mapWordPressHome(real);
    const validation = validateHomeContent(mapped);
    if (!validation.success) {
      // Fail with operator guidance instead of a bare assertion error:
      // usually the staging fields simply have not been filled in yet.
      const hint = describeAcfState(real);
      throw new Error(
        [
          "The real staging capture does not yet satisfy HomeContentSchema:",
          ...validation.details,
          ...(hint ? [hint] : []),
        ].join("\n")
      );
    }
    expect(validation.success).toBe(true);
  });

  it("maps the ACF image response format (array shape) correctly", () => {
    const mapped = mapWordPressHome(sample);
    expect(mapped.hero.image).toEqual({
      url: "https://staging.example.co.ke/wp-content/uploads/2026/08/hero-cloud.jpg",
      alt: "A high tech abstract background representing cloud systems",
    });
  });

  it("normalises string-URL images; ID-format images normalise to null (documented)", () => {
    expect(
      mapWordPressHome({ acf: { hero_image: "https://x.test/a.jpg" } }).hero.image
    ).toEqual({ url: "https://x.test/a.jpg", alt: "" });
    expect(mapWordPressHome({ acf: { hero_image: 128 } }).hero.image).toBeNull();
  });

  it("maps services and FAQs with stable IDs from the capture", () => {
    const mapped = mapWordPressHome(sample);
    expect(mapped.services.items.map((s) => s.id)).toEqual(["wp_srv_1", "wp_srv_2"]);
    expect(mapped.faqs.items.map((f) => f.id)).toEqual(["wp_faq_1", "wp_faq_2"]);
    expect(mapWordPressHome(sample)).toEqual(mapped);
  });

  it("fails safely when required fields are missing (no generic copy)", () => {
    const mapped = mapWordPressHome({ acf: { hero_eyebrow: "eyebrow only" } });
    expect(validateHomeContent(mapped).success).toBe(false);
  });

  it("reflects an edited hero_title in the mapped HomeContent", () => {
    const edited: WordPressPageResponse = {
      ...sample,
      acf: { ...sample.acf, hero_title: "EDITED VIA WORDPRESS: Karibu!" },
    };
    const mapped = mapWordPressHome(edited);
    expect(mapped.hero.title).toBe("EDITED VIA WORDPRESS: Karibu!");
    expect(validateHomeContent(mapped).success).toBe(true);
  });

  it("renders fixture and live mapped content through the same HomeTemplate", () => {
    const mapped = mapWordPressHome(sample);
    const validation = validateHomeContent(mapped);
    expect(validation.success).toBe(true);

    const fixtureHtml = renderToStaticMarkup(<HomeTemplate content={homeFixture} />);
    const liveHtml = renderToStaticMarkup(<HomeTemplate content={mapped} />);

    expect(fixtureHtml).toContain("Engineering bespoke software solutions");
    // Apostrophes are HTML-escaped by renderToStaticMarkup (&#x27;).
    expect(liveHtml).toContain("Powering Kenya&#x27;s modern digital service sectors");
    expect(liveHtml).toContain("Custom CRM &amp; Cloud Database Systems");
    expect(liveHtml).toContain("contact@amanitech.co.ke");
    expect(fixtureHtml).toContain("<footer");
    expect(liveHtml).toContain("<footer");
  });
});

describe("provider and security boundaries", () => {
  const config = {
    apiUrl: "https://staging.example.co.ke/wp-json",
    pageSlug: "home",
  };

  it("provider returns structured failures without leaking sensitive detail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const provider = new WordPressRestContentProvider(config);
    const result = await provider.fetchHomePage();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("http-error");
      expect(result.detail).not.toMatch(/password|authorization/i);
    }
    vi.unstubAllGlobals();
  });

  it("redacts sensitive keys and truncates long strings in diagnostics shape", async () => {
    const { redactWordPressResponseShape } = await import("@/lib/content/provider");
    const shape = redactWordPressResponseShape({
      app_password: "super-secret",
      authorization: "Basic abc",
      hero_title: "x".repeat(300),
      services: [
        { services_title: "A" },
        { services_title: "B" },
        { services_title: "C" },
      ],
    }) as Record<string, unknown>;
    expect(shape.app_password).toBe("[redacted]");
    expect(shape.authorization).toBe("[redacted]");
    expect(shape.hero_title).toMatch(/length 300/);
    expect((shape.services as unknown[]).length).toBe(3); // 2 sampled + marker
  });

  it("client code never references WordPress credentials", () => {
    const forbidden =
      /WORDPRESS_APP_PASSWORD|WORDPRESS_APP_USER|REVALIDATE_SECRET|appPassword|app_user/i;
    const offenders: string[] = [];
    for (const root of [
      join(__dirname, "..", "src", "components"),
      join(__dirname, "..", "src", "app"),
    ]) {
      for (const file of listFiles(root)) {
        if (!file.endsWith(".tsx") && !file.endsWith(".ts")) continue;
        const source = readFileSync(file, "utf-8");
        const isClientModule = /^['"]use client['"]/m.test(source);
        if (isClientModule && forbidden.test(source)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("environment files are git-ignored", () => {
    const gitignore = readFileSync(join(__dirname, "..", ".gitignore"), "utf-8");
    expect(gitignore).toMatch(/\.env/);
  });

  it("React components never import the raw WordPress types or adapter", () => {
    const forbidden =
      /@\/types\/wordpress|mapWordPressHome|WordPressRestContentProvider/;
    const offenders = listFiles(join(__dirname, "..", "src", "components")).filter(
      (file) => forbidden.test(readFileSync(file, "utf-8"))
    );
    expect(offenders).toEqual([]);
  });
});

describe("production failure policy and cache behaviour", () => {
  beforeEach(() => {
    resetLastKnownGood();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("production failure never renders fictional fixture content", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PREVIEW_MODE", "");
    vi.stubEnv("WORDPRESS_API_URL", "https://staging.example.co.ke/wp-json");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const result = await getHomeContent();
    expect(result.status).toBe("error");
    if (result.status === "ok") {
      expect(result.content).not.toEqual(homeFixture);
    }
    if (result.status === "error") {
      expect(result.reason).toBe("network-error");
    }
  });

  it("uses last-known-good content when WordPress later fails", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WORDPRESS_API_URL", "https://staging.example.co.ke/wp-json");
    const sample = loadCapture(samplePath, "sample capture");

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sample) })
    );
    const first = await getHomeContent();
    expect(first.status).toBe("ok");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const second = await getHomeContent();
    expect(second.status).toBe("ok");
    if (second.status === "ok") expect(second.source).toBe("last-known-good");
  });

  it("cache revalidation is configurable with a safe default", () => {
    vi.stubEnv("WORDPRESS_REVALIDATE_SECONDS", "");
    expect(getRevalidateSeconds()).toBe(3600);

    vi.stubEnv("WORDPRESS_REVALIDATE_SECONDS", "90");
    expect(getRevalidateSeconds()).toBe(90);

    vi.stubEnv("WORDPRESS_REVALIDATE_SECONDS", "bogus");
    expect(getRevalidateSeconds()).toBe(3600);
  });

  it("fetch options carry the revalidation tag; authenticated requests opt out of caching", () => {
    vi.stubEnv("WORDPRESS_REVALIDATE_SECONDS", "120");
    const publicOptions = buildWordPressFetchOptions(stagingConfig);
    expect((publicOptions.next as { tags: string[] }).tags).toEqual([REVALIDATE_TAG]);
    expect((publicOptions.next as { revalidate: number }).revalidate).toBe(120);
    expect(publicOptions.headers).not.toHaveProperty("Authorization");

    const privateOptions = buildWordPressFetchOptions({
      ...stagingConfig,
      appUser: "op",
      appPassword: "secret-pass",
    });
    expect(privateOptions.cache).toBe("no-store");
    expect(
      (privateOptions.headers as Record<string, string>).Authorization
    ).toMatch(/^Basic /);
  });

  it("server config reads only server-side env vars", () => {
    vi.stubEnv("WORDPRESS_API_URL", "https://staging.example.co.ke/wp-json");
    vi.stubEnv("WORDPRESS_PAGE_SLUG", "home");
    const cfg = getWordPressServerConfig();
    expect(cfg).not.toBeNull();
    expect(cfg?.pageSlug).toBe("home");
  });
});

describe("hero image ID resolution (native ACF REST exposes IDs)", () => {
  it("resolves a numeric image ID via the media endpoint", async () => {
    const base = loadCapture(samplePath, "sample");
    const raw: WordPressPageResponse = {
      ...base,
      acf: { ...base.acf, hero_image: 31 },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          source_url:
            "https://staging.example.co.ke/wp-content/uploads/hero.jpg",
          alt_text: "Team at work",
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new WordPressRestContentProvider(stagingConfig);
    const resolved = await resolveHeroImage(provider, raw);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0] as string).toContain("/wp/v2/media/31");
    expect(resolved.acf?.hero_image).toEqual({
      url: "https://staging.example.co.ke/wp-content/uploads/hero.jpg",
      alt: "Team at work",
    });
    vi.unstubAllGlobals();
  });

  it("leaves the response untouched when media resolution fails (still valid)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404 })
    );
    const base = loadCapture(samplePath, "sample");
    const raw: WordPressPageResponse = {
      ...base,
      acf: { ...base.acf, hero_image: 31 },
    };
    const provider = new WordPressRestContentProvider(stagingConfig);
    const resolved = await resolveHeroImage(provider, raw);
    expect(resolved.acf?.hero_image).toBe(31);
    // Unresolvable image maps to null; image is nullable so content stays valid.
    expect(validateHomeContent(mapWordPressHome(resolved)).success).toBe(true);
    vi.unstubAllGlobals();
  });

  it("getHomeContent resolves the image end-to-end (page fetch + media fetch)", async () => {
    resetLastKnownGood();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WORDPRESS_API_URL", "https://staging.example.co.ke/wp-json");
    const base = loadCapture(samplePath, "sample");
    const raw: WordPressPageResponse = {
      ...base,
      acf: { ...base.acf, hero_image: 31 },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(raw) })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            source_url:
              "https://staging.example.co.ke/wp-content/uploads/hero.jpg",
            alt_text: "Hero",
          }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getHomeContent();
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.content.hero.image?.url).toBe(
        "https://staging.example.co.ke/wp-content/uploads/hero.jpg"
      );
      expect(result.content.hero.image?.alt).toBe("Hero");
    }
    vi.unstubAllGlobals();
  });
});

describe("acf state diagnostics", () => {
  it("returns the fill-in hint when the group is exposed but every value is empty", () => {
    const raw: WordPressPageResponse = {
      id: 6,
      slug: "home",
      acf: {
        hero_title: "",
        hero_text: "",
        about_title: "",
        services: null,
        contact_email: "",
      },
    };
    const hint = describeAcfState(raw);
    expect(hint).toContain("every field");
    expect(hint).toContain("value is empty");
    expect(hint).toContain("/api/revalidate");
  });

  it("returns the REST-exposure hint when the acf object is absent", () => {
    const hint = describeAcfState({ id: 6, slug: "home" });
    expect(hint).toContain("Show in REST API");
    expect(hint).toContain("location rule");
  });

  it("returns null when at least one field has a value", () => {
    const hint = describeAcfState({
      id: 6,
      slug: "home",
      acf: { hero_title: "Filled", contact_email: "" },
    });
    expect(hint).toBeNull();
  });

  it("getHomeContent surfaces the fill-in hint in the error details", async () => {
    resetLastKnownGood();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PREVIEW_MODE", "");
    vi.stubEnv("WORDPRESS_API_URL", "https://staging.example.co.ke/wp-json");
    // Mirrors the live staging state observed 2026-08-30: correct field
    // names, all values empty, empty repeaters omitted.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 6,
            slug: "home",
            acf: {
              hero_eyebrow: "",
              hero_title: "",
              hero_text: "",
              hero_button_text: "",
              hero_button_url: "",
              hero_image: null,
              about_title: "",
              about_text: "",
              services_section_title: "",
              faqs_section_title: "",
              contact_title: "",
              contact_phone: "",
              contact_email: "",
              footer_copyright: "",
            },
          }),
      })
    );

    const result = await getHomeContent();
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.reason).toBe("validation-error");
      expect(result.details.some((d) => d.includes("every field"))).toBe(true);
    }
  });
});
