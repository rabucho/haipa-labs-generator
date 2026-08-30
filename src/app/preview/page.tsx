import type { Metadata } from "next";
import { HomeTemplate } from "@/components/HomeTemplate";
import { getHomeContent } from "@/lib/content/wordpress";
import styles from "./preview.module.css";

export const metadata: Metadata = {
  title: "Site Preview — Haipa Labs",
  description: "Public preview of the generated site, rendered from validated content.",
};

export const dynamic = "force-dynamic";

/**
 * /preview — the public generated-site preview.
 * Renders the approved HomeTemplate from fixture content (development /
 * PREVIEW_MODE) or validated WordPress content, and shows a safe error
 * state when neither is available.
 */
export default async function PreviewPage() {
  const result = await getHomeContent();

  if (result.status === "error") {
    const reasonLabel: Record<string, string> = {
      "missing-config": "WordPress is not configured",
      "http-error": "WordPress is unavailable",
      "empty-response": "Home page not found in WordPress",
      "network-error": "WordPress is unreachable",
      "validation-error": "Content failed validation",
      unexpected: "Unexpected error",
    };
    return (
      <main className={styles.errorState}>
        <div className="container">
          <span className="eyebrow">Haipa Labs</span>
          <h1 className="section-title">
            {reasonLabel[result.reason] ?? "Content is temporarily unavailable"}
          </h1>
          <p className={styles.errorMessage}>{result.message}</p>
          <ul className={styles.errorDetails}>
            {result.details.map((detail, idx) => (
              <li key={idx}>{detail}</li>
            ))}
          </ul>
          <p className={styles.errorDetails}>
            Reason code: <code>{result.reason}</code>
          </p>
        </div>
      </main>
    );
  }

  return (
    <>
      {result.source !== "wordpress" && (
        <div className={styles.sourceBanner}>
          Content source: <strong>{result.source}</strong>
          {result.source === "last-known-good" && " (live WordPress is currently unavailable)"}
        </div>
      )}
      <HomeTemplate content={result.content} />
    </>
  );
}