import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { contentInventory } from "@/content/content-inventory";
import { homeFixture } from "@/content/home.fixture";
import { HomeContentSchema, HomeContent } from "@/types/content";
import {
  buildEditorFields,
  buildEditorSections,
} from "@/lib/editor/fields";
import { validateEditorDraft } from "@/lib/editor/validate-draft";
import {
  EDITOR_SITE_KEY,
  JsonFileDraftRepository,
  hashContent,
} from "@/lib/editor/draft-store";
import { HomeTemplate } from "@/components/HomeTemplate";
import { mapWordPressHome } from "@/lib/content/wordpress";
import { wordpressSampleResponse } from "@/content/wordpress-sample";
import { POST as savePOST } from "@/app/api/editor/save/route";
import { POST as publishPOST } from "@/app/api/editor/publish/route";
import { POST as rollbackPOST } from "@/app/api/editor/rollback/route";
import { GET as statusGET } from "@/app/api/editor/status/route";

const dataDir = join(
  tmpdir(),
  `omoka-editor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
);

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function cloneFixture(): HomeContent {
  return JSON.parse(JSON.stringify(homeFixture)) as HomeContent;
}

function post(url: string, body: unknown) {
  return jsonRequest(`http://localhost${url}`, body);
}

/** Removes a site's editor dir so route tests start from a known state. */
async function resetSite(siteKey: string): Promise<void> {
  await fs.rm(join(dataDir, "editor", siteKey), {
    recursive: true,
    force: true,
  });
}

beforeAll(() => {
  process.env.EDITOR_DATA_DIR = dataDir;
});

afterAll(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
  delete process.env.EDITOR_DATA_DIR;
});

describe("inventory-driven editor form generation", () => {
  const fields = buildEditorFields(contentInventory);
  const { sections, designControlled } = buildEditorSections(contentInventory);

  it("generates an editable field for every editable inventory item", () => {
    const fieldPaths = new Set(fields.map((f) => f.path));
    const missing = contentInventory
      .filter((f) => f.editable)
      .map((f) => f.path)
      .filter((p) => !fieldPaths.has(p) && !p.endsWith(".items"));
    expect(missing).toEqual([]);
  });

  it("excludes design-controlled items from editable fields", () => {
    expect(fields.some((f) => f.path.startsWith("layout."))).toBe(false);
    expect(designControlled.map((d) => d.path)).toEqual([
      "layout.spacing",
      "layout.colors",
      "layout.typography",
    ]);
  });

  it("keeps labels and stable wpNames from the approved inventory", () => {
    const heroTitle = fields.find((f) => f.path === "hero.title");
    expect(heroTitle).toMatchObject({
      label: "Hero Main Title",
      wpName: "hero_title",
      type: "text",
      required: true,
      maxLength: 120,
      section: "hero",
    });
    const contactEmail = fields.find((f) => f.path === "contact.email");
    expect(contactEmail?.type).toBe("email");
  });

  it("maps services and faqs repeaters with nested subfields", () => {
    const services = sections.find((s) => s.key === "services");
    expect(services?.repeater?.itemsPath).toBe("services.items");
    expect(services?.repeater?.fields.map((f) => f.wpName)).toEqual([
      "services_title",
      "services_description",
      "services_url",
    ]);
    const faqs = sections.find((s) => s.key === "faqs");
    expect(faqs?.repeater?.fields.map((f) => f.wpName)).toEqual([
      "faqs_question",
      "faqs_answer",
    ]);
  });

  it("maps image fields to the image editor type", () => {
    const heroImage = fields.find((f) => f.path === "hero.image");
    expect(heroImage?.type).toBe("image");
  });
});

describe("validateEditorDraft (unknown fields + schema)", () => {
  it("accepts the approved fixture as a valid draft", () => {
    const result = validateEditorDraft(cloneFixture());
    expect(result.ok).toBe(true);
  });

  it("rejects unknown top-level fields", () => {
    const bad = { ...cloneFixture(), evilKey: "nope" };
    const result = validateEditorDraft(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("Unknown field: evilKey"))).toBe(true);
    }
  });

  it("rejects unknown nested fields", () => {
    const draft = cloneFixture();
    (draft.hero as unknown as Record<string, unknown>).color = "red";
    const result = validateEditorDraft(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("Unknown field: hero.color"))).toBe(true);
    }
  });

  it("rejects unknown repeater row fields", () => {
    const draft = cloneFixture();
    (draft.services.items[0] as unknown as Record<string, unknown>).widget = 1;
    const result = validateEditorDraft(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some((e) => e.includes("Unknown field: services.items[0].widget"))
      ).toBe(true);
    }
  });

  it("rejects drafts failing the schema (missing required field)", () => {
    const draft = cloneFixture();
    draft.hero.title = "";
    const result = validateEditorDraft(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("hero.title"))).toBe(true);
    }
  });

  it("allows optional fields to be omitted", () => {
    const draft = cloneFixture();
    delete (draft.services.items[0] as { href?: string }).href;
    const result = validateEditorDraft(draft);
    expect(result.ok).toBe(true);
  });
});

describe("draft persistence and routes (JSON file repository)", () => {
  const repo = new JsonFileDraftRepository();

  it("saves a valid draft and returns a deterministic hash", async () => {
    const content = cloneFixture();
    const snapshot = await repo.saveDraft("store-test", content);
    expect(snapshot.hash).toBe(hashContent(content));
    const loaded = await repo.loadDraft("store-test");
    expect(loaded?.hash).toBe(snapshot.hash);
    expect(loaded?.content).toEqual(content);
  });

  it("save route: 200 for a valid draft, 400 for invalid or unknown fields", async () => {
    const valid = cloneFixture();
    valid.hero.title = "Valid draft title";
    const ok = await savePOST(post("/api/editor/save", valid));
    expect(ok.status).toBe(200);
    const okBody = await ok.json();
    expect(okBody.ok).toBe(true);

    const invalid = cloneFixture();
    invalid.hero.title = "";
    const bad = await savePOST(post("/api/editor/save", invalid));
    expect(bad.status).toBe(400);
    const badBody = await bad.json();
    expect(badBody.errors.some((e: string) => e.includes("hero.title"))).toBe(true);

    const unknown = { ...cloneFixture(), sneaky: true };
    const unknownRes = await savePOST(post("/api/editor/save", unknown));
    expect(unknownRes.status).toBe(400);
  });

  it("publish route: requires a saved draft and re-validates it", async () => {
    await resetSite(EDITOR_SITE_KEY);
    const none = await publishPOST();
    expect(none.status).toBe(400);

    const content = cloneFixture();
    content.hero.title = "Published snapshot title";
    await savePOST(post("/api/editor/save", content));
    const ok = await publishPOST();
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.hash).toBe(hashContent(content));
  });

  it("invalid draft rejection does not replace the published snapshot", async () => {
    const v1 = cloneFixture();
    v1.hero.title = "Known-good published title";
    await repo.saveDraft("safe-site", v1);
    const published = await repo.publishDraft("safe-site", v1);

    const invalid = cloneFixture();
    invalid.contact.email = "not-an-email";
    const saveRes = await savePOST(post("/api/editor/save", invalid));
    expect(saveRes.status).toBe(400);

    const still = await repo.loadPublished("safe-site");
    expect(still?.hash).toBe(published.hash);
    expect(still?.content.hero.title).toBe("Known-good published title");
  });

  it("stable repeater IDs remain unchanged when editing and removing rows", async () => {
    const draft = cloneFixture();
    draft.services.items[1].title = "Edited service title";
    const saved = await repo.saveDraft("ids-site", draft);
    expect(saved.content.services.items.map((s) => s.id)).toEqual([
      "srv_1",
      "srv_2",
      "srv_3",
    ]);

    draft.services.items.splice(0, 1);
    const after = await repo.saveDraft("ids-site", draft);
    expect(after.content.services.items.map((s) => s.id)).toEqual([
      "srv_2",
      "srv_3",
    ]);
  });

  it("rollback restores the previous known-good local snapshot", async () => {
    const v1 = cloneFixture();
    v1.hero.title = "Rollback target title";
    const v2 = cloneFixture();
    v2.hero.title = "Latest published title";

    expect(await repo.hasRollbackSnapshot("rollback-site")).toBe(false);
    await repo.publishDraft("rollback-site", v1);
    await repo.publishDraft("rollback-site", v2);

    expect(await repo.hasRollbackSnapshot("rollback-site")).toBe(true);
    const current = await repo.loadPublished("rollback-site");
    expect(current?.content.hero.title).toBe("Latest published title");

    const restored = await repo.rollbackPublished("rollback-site");
    expect(restored?.content.hero.title).toBe("Rollback target title");
    expect(restored?.hash).toBe(hashContent(v1));
    expect(await repo.hasRollbackSnapshot("rollback-site")).toBe(false);
    expect(await repo.rollbackPublished("rollback-site")).toBeNull();
  });

  it("rollback route requires explicit confirmation", async () => {
    await resetSite(EDITOR_SITE_KEY);
    const noConfirm = await rollbackPOST(
      post("/api/editor/rollback", { confirm: false })
    );
    expect(noConfirm.status).toBe(400);

    const none = await rollbackPOST(
      post("/api/editor/rollback", { confirm: true })
    );
    expect(none.status).toBe(404);
  });

  it("status route reports hashes, unpublished changes, and rollback availability", async () => {
    await resetSite(EDITOR_SITE_KEY);
    const v1 = cloneFixture();
    await repo.saveDraft(EDITOR_SITE_KEY, v1);
    await repo.publishDraft(EDITOR_SITE_KEY, v1);

    const draft = cloneFixture();
    draft.hero.title = "A different draft";
    await repo.saveDraft(EDITOR_SITE_KEY, draft);

    const res = await statusGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.siteKey).toBe("home");
    expect(body.unpublishedChanges).toBe(true);

    await repo.publishDraft(EDITOR_SITE_KEY, draft);
    const res2 = await statusGET();
    const body2 = await res2.json();
    expect(body2.unpublishedChanges).toBe(false);
  });
});

describe("drafts never touch WordPress", () => {
  it("save, publish, and rollback make no network calls of any kind", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const repo = new JsonFileDraftRepository();

    const content = cloneFixture();
    content.hero.title = "Local-only title";
    await repo.saveDraft("wp-free-site", content);
    await repo.publishDraft("wp-free-site", content);
    await repo.rollbackPublished("wp-free-site");

    await savePOST(post("/api/editor/save", content));
    await publishPOST();

    expect(fetchSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe("one HomeContent contract for every content source", () => {
  it("fixture, live capture, draft, and published all satisfy the schema", async () => {
    // Fixture
    expect(HomeContentSchema.safeParse(homeFixture).success).toBe(true);

    // Live capture mapped through the adapter
    const live = mapWordPressHome(wordpressSampleResponse);
    expect(HomeContentSchema.safeParse(live).success).toBe(true);

    // Draft + published snapshots from the store
    const draftContent = cloneFixture();
    draftContent.hero.title = "Contract check draft";
    const repo = new JsonFileDraftRepository();
    const draft = await repo.saveDraft("contract-site", draftContent);
    const published = await repo.publishDraft("contract-site", draftContent);

    expect(HomeContentSchema.safeParse(draft.content).success).toBe(true);
    expect(HomeContentSchema.safeParse(published.content).success).toBe(true);
  });
});

describe("draft and published previews render through HomeTemplate", () => {
  it("renders draft content through the approved template", async () => {
    const repo = new JsonFileDraftRepository();
    const content = cloneFixture();
    content.hero.title = "Draft preview title";
    const draft = await repo.saveDraft("preview-site", content);
    const html = renderToStaticMarkup(<HomeTemplate content={draft.content} />);
    expect(html).toContain("Draft preview title");
    expect(html).toContain("<footer");
  });

  it("renders published content through the approved template", async () => {
    const repo = new JsonFileDraftRepository();
    const content = cloneFixture();
    content.hero.title = "Published preview title";
    const published = await repo.publishDraft("preview-pub-site", content);
    const html = renderToStaticMarkup(
      <HomeTemplate content={published.content} />
    );
    expect(html).toContain("Published preview title");
  });
});
