import type { Metadata } from "next";
import Link from "next/link";
import { HomeTemplate } from "@/components/HomeTemplate";
import { getHomeContent } from "@/lib/content/wordpress";
import {
  EDITOR_SITE_KEY,
  editorRepository,
} from "@/lib/editor/draft-store";
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
export default async function PreviewPage({
  searchParams,
}: {
  searchParams?: Promise<{ source?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const source = params.source;

  // Draft/published previews render the local editor snapshots through the
  // SAME HomeTemplate; they never touch live WordPress data.
  if (source === "draft" || source === "published") {
    const snapshot =
      source === "draft"
        ? await editorRepository.loadDraft(EDITOR_SITE_KEY)
        : await editorRepository.loadPublished(EDITOR_SITE_KEY);

    if (!snapshot) {
      return (
        <main className={styles.errorState}>
          <div className="container">
            <span className="eyebrow">Haipa Labs</span>
            <h1 className="section-title">
              No {source} content yet
            </h1>
            <p className={styles.errorMessage}>
              {source === "draft"
                ? "Save a draft in the internal editor first."
                : "Publish an approved draft first."}
            </p>
            <p className={styles.errorDetails}>
              <Link href="/editor" className={styles.textLink}>
                Open the internal editor →
              </Link>
            </p>
          </div>
        </main>
      );
    }

    return (
      <>
        <div className={styles.sourceBanner}>
          Content source: <strong>{source} snapshot</strong> (local editor
          content, hash <code>{snapshot.hash}</code>
          {snapshot
            ? "savedAt" in snapshot
              ? ` · saved ${new Date(snapshot.savedAt).toLocaleString()}`
              : ` · published ${new Date(snapshot.publishedAt).toLocaleString()}`
            : ""}
          )
        </div>
        <HomeTemplate content={snapshot.content} />
      </>
    );
  }

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