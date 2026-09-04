import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { rmSync } from "fs";
import { join } from "path";
import { StagingWordPressProvider } from "@/lib/wordpress-staging/provider";

const dataDir = join(process.cwd(), ".slice20-test-data");

beforeAll(() => {
  process.env.PROJECTS_DATA_DIR = join(dataDir, "projects");
  process.env.TEMPLATES_DATA_DIR = join(process.cwd(), ".slice20-templates");
  process.env.WORDPRESS_INTEGRATION_ENABLED = "true";
  process.env.WORDPRESS_STAGING_URL = "https://staging.example.co.ke/wp-json";
  process.env.WORDPRESS_TIMEOUT_MS = "50";
  process.env.WORDPRESS_MAX_RETRIES = "1";
  rmSync(dataDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function providerWithEnv(overrides: Record<string, string> = {}) {
  const { getWordPressStagingConfig } = (await import(
    "@/lib/wordpress-staging/config"
  )) as {
    getWordPressStagingConfig: () => import("@/lib/wordpress-staging/types").WordPressStagingConfig;
  };
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  const provider = new StagingWordPressProvider(getWordPressStagingConfig());
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return provider;
}

/** A fetch stub whose rejections carry undici-style cause codes. */
function failingFetch(error: Error) {
  return vi.fn().mockRejectedValue(error);
}

function fetchError(name: string, code: string): Error {
  const e = new Error(name);
  Object.defineProperty(e, "name", { value: name });
  (e as unknown as { cause: { code: string } }).cause = { code };
  return e;
}

describe("Slice 20 — phase-specific connectivity diagnostics", () => {
  it("classifies DNS failures as dns-failure, non-retryable, phase dns", async () => {
    const provider = await providerWithEnv();
    vi.stubGlobal("fetch", failingFetch(fetchError("TypeError", "ENOTFOUND")));
    const d = await provider.diagnose();
    expect(d.ok).toBe(false);
    expect(d.errorCode).toBe("dns-failure");
    expect(d.phase).toBe("dns");
    expect(d.retryable).toBe(false);
    expect(d.elapsedMs).toBeTypeOf("number");
    expect(d.remediation).toBeTruthy();
  });

  it("classifies TLS/certificate failures as tls-failure, phase tls", async () => {
    const provider = await providerWithEnv();
    vi.stubGlobal(
      "fetch",
      failingFetch(fetchError("TypeError", "ERR_TLS_CERT_ALTNAME_INVALID"))
    );
    const d = await provider.diagnose();
    expect(d.ok).toBe(false);
    expect(d.errorCode).toBe("tls-failure");
    expect(d.phase).toBe("tls");
    expect(d.retryable).toBe(false);
  });

  it("reports timeout with phase http, without leaking a stack trace", async () => {
    const provider = await providerWithEnv();
    vi.stubGlobal(
      "fetch",
      failingFetch(fetchError("AbortError", "UND_ERR_ABORTED"))
    );
    const d = await provider.diagnose();
    expect(d.ok).toBe(false);
    expect(d.errorCode).toBe("timeout");
    expect(d.phase).toBe("http");
    expect(d.retryable).toBe(true);
    expect(d.detail).not.toContain("at ");
    expect(d.detail).toContain("REST root check failed");
  });

  it("classifies connection-refused as network-error with a bounded retry", async () => {
    const provider = await providerWithEnv();
    const fetchMock = failingFetch(fetchError("TypeError", "ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);
    const d = await provider.diagnose();
    expect(d.ok).toBe(false);
    expect(d.errorCode).toBe("network-error");
    expect(d.phase).toBe("http");
    // WORDPRESS_MAX_RETRIES=1 → exactly 2 attempts for the idempotent root probe.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries HTTP 5xx only within WORDPRESS_MAX_RETRIES", async () => {
    const provider = await providerWithEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("upstream error", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);
    const d = await provider.diagnose();
    expect(d.ok).toBe(false);
    expect(d.errorCode).toBe("http-502");
    expect(d.phase).toBe("http");
    expect(d.statusCode).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 + maxRetries(1), never unbounded
  });

  it("sync = one safe GET lookup + exactly one POST write (never retried)", async () => {
    const provider = await providerWithEnv();
    const calls: Array<{ method: string; path: string }> = [];
    const fetchMock = vi.fn().mockImplementation(
      async (url: string, init?: { method?: string }) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const path = String(url).replace(/^https?:\/\/[^/]+/, "");
        if (method === "POST") {
          calls.push({ method, path });
          return new Response("upstream error", { status: 502 });
        }
        calls.push({ method, path });
        return new Response(JSON.stringify([{ id: "6", slug: "home" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await provider.syncApprovedContent({
      project: {
        id: "proj_x",
        name: "X",
        slug: "x",
        wordpressConnection: { pageId: 6 },
      } as never,
      approvedDraft: { id: "draft_1", content: {} } as never,
      mappings: [],
    });
    // Request sequence: safe GET page lookup first, then ONE write.
    const gets = calls.filter((c) => c.method === "GET");
    const posts = calls.filter((c) => c.method === "POST");
    expect(gets.length).toBe(1); // lookup succeeded on the first attempt
    expect(gets[0]?.path).toContain("/wp-json/wp/v2/pages");
    expect(posts).toHaveLength(1); // exactly one write attempt, never retried
    expect(posts[0]?.path).toContain("/wp-json/wp/v2/pages");
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
    expect(result.ok).toBe(false);
  });

  it("reports invalid REST (non-JSON) responses as bad-json, phase rest", async () => {
    const provider = await providerWithEnv();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<html>not json</html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          })
        )
    );
    const d = await provider.diagnose();
    expect(d.ok).toBe(false);
    expect(d.errorCode).toBe("bad-json");
    expect(d.phase).toBe("rest");
  });

  it("reports authentication failures at phase auth without leaking credentials", async () => {
    const provider = await providerWithEnv({
      WORDPRESS_AUTH_SECRET_REFERENCE: "TEST_WP_SECRET",
    });
    process.env.TEST_WP_SECRET = "super-secret-app-password";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }))
    );
    const d = await provider.diagnose();
    expect(d.ok).toBe(false);
    expect(d.errorCode).toBe("auth-failed");
    expect(d.phase).toBe("auth");
    expect(d.statusCode).toBe(401);
    const serialized = JSON.stringify(d);
    expect(serialized).not.toContain("super-secret-app-password");
    expect(serialized).not.toContain("Authorization");
    delete process.env.TEST_WP_SECRET;
  });

  it("misconfigured integration reports phase configuration, zero network", async () => {
    const provider = await providerWithEnv({
      WORDPRESS_INTEGRATION_ENABLED: "false",
    });
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const d = await provider.diagnose();
    expect(d.ok).toBe(false);
    expect(d.errorCode).toBe("misconfigured");
    expect(d.phase).toBe("configuration");
    expect(d.elapsedMs).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("successful diagnosis reports phase rest with elapsed time", async () => {
    const provider = await providerWithEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("/wp-json/wp/v2/pages")) {
          return Promise.resolve(new Response("[]", { status: 200 }));
        }
        if (String(url).includes("/wp-json/acf/")) {
          return Promise.reject(new TypeError("no acf"));
        }
        return Promise.resolve(
          new Response(JSON.stringify({ description: "WordPress" }), {
            status: 200,
          })
        );
      })
    );
    const d = await provider.diagnose();
    expect(d.ok).toBe(true);
    expect(d.phase).toBe("rest");
    expect(d.elapsedMs).toBeTypeOf("number");
  });
});

describe("Slice 20 — audit id uniqueness", () => {
  it("generate route appends a fresh audit id per event (source contract)", async () => {
    const { readFileSync } = await import("fs");
    const src = readFileSync(
      join(
        process.cwd(),
        "src/app/api/projects/[projectId]/generate/route.ts"
      ),
      "utf-8"
    );
    // The shared auditBase must NOT carry an id (that caused duplicates).
    const baseMatch = src.match(/const auditBase = \{([\s\S]*?)\};/);
    expect(baseMatch).not.toBeNull();
    expect(baseMatch![1]).not.toContain("id:");
    // Each of the three append sites generates its own unique id.
    const appendCount = (src.match(/generationAuditRepository\.append\(/g) ?? [])
      .length;
    const freshIdCount = (src.match(/id: `audit_\$\{randomUUID\(\)\}`/g) ?? [])
      .length;
    expect(appendCount).toBe(3);
    expect(freshIdCount).toBe(3);
  });
});

