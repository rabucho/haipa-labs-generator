import { describe, it, expect, vi, afterEach } from "vitest";
import { diagnoseProvider } from "@/lib/generation/provider-registry";
import { PAGE_MANIFEST, enabledPages } from "@/types/pages";
import { buildPageAwareInventory } from "@/lib/templates/page-inventory";

// ── Provider diagnosis (Stage A) ────────────────────────────────────────

describe("provider diagnosis", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("deterministic provider is always reachable with zero network", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const d = await diagnoseProvider("deterministic");
    expect(d.status).toBe("reachable");
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports unconfigured providers without network", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const d = await diagnoseProvider("gemini");
    expect(d.status).toBe("unconfigured");
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports configured-but-disabled providers without network", async () => {
    vi.stubEnv("AI_GEMINI_ENABLED", "false");
    vi.stubEnv("AI_GEMINI_MODEL", "gemini-2.0-flash");
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const d = await diagnoseProvider("gemini");
    expect(d.status).toBe("configured");
    expect(spy).not.toHaveBeenCalled();
  });

  it("maps authentication failures to a safe status without leaking bodies", async () => {
    vi.stubEnv("AI_OPENROUTER_ENABLED", "true");
    vi.stubEnv("AI_OPENROUTER_MODEL", "test/model");
    vi.stubEnv("AI_OPENROUTER_API_KEY", "sk-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401 })
    );
    const d = await diagnoseProvider("openrouter");
    expect(d.status).toBe("authentication_failed");
    const serialized = JSON.stringify(d);
    expect(serialized).not.toContain("sk-secret");
  });

  it("reports model_unavailable when the catalog lacks the configured model", async () => {
    vi.stubEnv("AI_OPENROUTER_ENABLED", "true");
    vi.stubEnv("AI_OPENROUTER_MODEL", "missing/model");
    vi.stubEnv("AI_OPENROUTER_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [{ id: "other/model" }] }),
      })
    );
    const d = await diagnoseProvider("openrouter");
    expect(d.status).toBe("model_unavailable");
  });

  it("reports reachable when the catalog contains the model", async () => {
    vi.stubEnv("AI_OPENROUTER_ENABLED", "true");
    vi.stubEnv("AI_OPENROUTER_MODEL", "test/model");
    vi.stubEnv("AI_OPENROUTER_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [{ id: "test/model" }] }),
      })
    );
    const d = await diagnoseProvider("openrouter");
    expect(d.status).toBe("reachable");
  });

  it("maps timeouts and quota errors to safe statuses", async () => {
    vi.stubEnv("AI_OPENROUTER_ENABLED", "true");
    vi.stubEnv("AI_OPENROUTER_MODEL", "test/model");
    vi.stubEnv("AI_OPENROUTER_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429 })
    );
    const quota = await diagnoseProvider("openrouter");
    expect(quota.status).toBe("quota_limited");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        () => new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("x"), { name: "AbortError" })), 5))
      )
    );
    const timeout = await diagnoseProvider("openrouter");
    expect(timeout.status).toBe("unreachable");
  });
});

// ── Page-aware exports (Stage D) ────────────────────────────────────────

describe("page-aware export payloads", () => {
  it("page inventory covers every editable field exactly once with page keys", () => {
    const fields = buildPageAwareInventory();
    const paths = fields.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const f of fields) {
      expect(f.pageKey).toBeTruthy();
      expect(f.wpName).toBeTruthy();
      expect(f.sourceComponent).toBeTruthy();
    }
  });

  it("excludes design-controlled values and disabled Shop", () => {
    const fields = buildPageAwareInventory();
    expect(fields.some((f) => f.path.startsWith("layout."))).toBe(false);
    expect(fields.some((f) => f.pageKey === "shop")).toBe(false);
    expect(enabledPages({}).some((p) => p.pageKey === "shop")).toBe(false);
  });

  it("manifest declares the documented WordPress strategy inputs (5 pages, shop gated)", () => {
    expect(PAGE_MANIFEST.filter((p) => p.requiresCapability === "none").length).toBe(5);
  });
});
