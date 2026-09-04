import type { Metadata } from "next";
import {
  getWordPressServerConfig,
  isFixtureFallbackAllowed,
  getRevalidateSeconds,
  REVALIDATE_TAG,
} from "@/lib/content/server-config";
import {
  WordPressRestContentProvider,
  redactWordPressResponseShape,
  redactConfig,
} from "@/lib/content/provider";
import { mapWordPressHome } from "@/lib/content/wordpress";
import { validateHomeContent } from "@/lib/content/validate";
import styles from "./diagnostics.module.css";

export const metadata: Metadata = {
  title: "WordPress Diagnostics — Haipa Labs",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * /diagnostics — DEVELOPMENT/PREVIEW-ONLY view of the real WordPress REST
 * response shape with sensitive values removed. Never rendered in production.
 * Shows: effective (redacted) config, cache settings, the redacted response
 * shape, mapping status, and the mapped HomeContent.
 */
export default function DiagnosticsPage() {
  if (!isFixtureFallbackAllowed()) {
    return (
      <main className={styles.page}>
        <div className="container">
          <span className="eyebrow">Haipa Labs Diagnostics</span>
          <h1 className="section-title">Diagnostics disabled</h1>
          <p className={styles.muted}>
            This view is available only with NODE_ENV=development or
            PREVIEW_MODE=true. Production never exposes diagnostics.
          </p>
        </div>
      </main>
    );
  }

  const config = getWordPressServerConfig();
  const revalidateSeconds = getRevalidateSeconds();

  if (!config) {
    return (
      <main className={styles.page}>
        <div className="container">
          <span className="eyebrow">Haipa Labs Diagnostics</span>
          <h1 className="section-title">WordPress not configured</h1>
          <p className={styles.muted}>
            Set WORDPRESS_API_URL (and optionally HOME_PAGE_ID /
            WORDPRESS_PAGE_SLUG) in <code>.env.local</code>, then reload. See{" "}
            <code>docs/wordpress-staging-setup.md</code>.
          </p>
        </div>
      </main>
    );
  }

  const authMode = config.appUser && config.appPassword ? "authenticated (Basic, server-side only)" : "public (unauthenticated)";
  const cacheMode =
    config.appUser && config.appPassword
      ? "no-store (Next.js skips caching authorized requests)"
      : `cached for ${revalidateSeconds}s, tag "${REVALIDATE_TAG}"`;

  return (
    <main className={styles.page}>
      <div className="container">
        <span className="eyebrow">Haipa Labs Diagnostics (dev/preview only)</span>
        <h1 className="section-title">WordPress Response Diagnostics</h1>

        <h2 className={styles.subheading}>Effective configuration (redacted)</h2>
        <pre className={styles.block}>
          {JSON.stringify(redactConfig(config), null, 2)}
        </pre>

        <h2 className={styles.subheading}>Cache behaviour</h2>
        <ul className={styles.muted}>
          <li>Revalidation window: <strong>{revalidateSeconds}s</strong> (WORDPRESS_REVALIDATE_SECONDS)</li>
          <li>Fetch tag: <strong>{REVALIDATE_TAG}</strong> (invalidated via POST /api/revalidate)</li>
          <li>Auth mode: <strong>{authMode}</strong></li>
          <li>Cache mode: <strong>{cacheMode}</strong></li>
        </ul>

        <h2 className={styles.subheading}>Redacted REST response shape</h2>
        <DiagnosticsFetch config={config} />
        <h2 className={styles.subheading}>Notes</h2>
        <ul className={styles.muted}>
          <li>Values are redacted: sensitive keys → [redacted]; long strings truncated with length preserved.</li>
          <li>To verify an edit → publish → render loop, see docs/wordpress-staging-setup.md step 8–10.</li>
        </ul>
      </div>
    </main>
  );
}

async function DiagnosticsFetch({ config }: { config: NonNullable<ReturnType<typeof getWordPressServerConfig>> }) {
  const provider = new WordPressRestContentProvider(config);
  const fetched = await provider.fetchHomePage();

  if (!fetched.ok) {
    return (
      <div className={styles.errorBox}>
        <p><strong>Fetch failed ({fetched.reason}):</strong> {fetched.detail}</p>
      </div>
    );
  }

  const mapped = mapWordPressHome(fetched.raw);
  const validation = validateHomeContent(mapped);

  return (
    <>
      <pre className={styles.block}>
        {JSON.stringify(redactWordPressResponseShape(fetched.raw), null, 2)}
      </pre>
      <h2 className={styles.subheading}>Mapping status</h2>
      {validation.success ? (
        <p className={styles.ok}>✅ Mapped object passed HomeContentSchema validation.</p>
      ) : (
        <div className={styles.errorBox}>
          <p><strong>Validation failed:</strong></p>
          <ul>
            {validation.details.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      )}
      <h2 className={styles.subheading}>Mapped HomeContent</h2>
      <pre className={styles.block}>{JSON.stringify(validation.success ? validation.data : mapped, null, 2)}</pre>
    </>
  );
}
