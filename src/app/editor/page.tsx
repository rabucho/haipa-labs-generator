import type { Metadata } from "next";
import Link from "next/link";
import { contentInventory } from "@/content/content-inventory";
import { buildEditorSections } from "@/lib/editor/fields";
import {
  EDITOR_SITE_KEY,
  editorRepository,
} from "@/lib/editor/draft-store";
import { getHomeContent } from "@/lib/content/wordpress";
import EditorForm from "./EditorForm";
import styles from "./editor.module.css";

export const metadata: Metadata = {
  title: "Content Editor — Haipa Labs (Internal)",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * /editor — INTERNAL Haipa Labs operator draft editor (not customer-facing).
 * Edits locally persisted draft content; live WordPress content is never
 * modified by this page. Fields are generated from the approved
 * ContentInventory; drafts are validated against HomeContentSchema.
 */
export default async function EditorPage() {
  const [draft, published] = await Promise.all([
    editorRepository.loadDraft(EDITOR_SITE_KEY),
    editorRepository.loadPublished(EDITOR_SITE_KEY),
  ]);

  let initialContent = draft?.content ?? published?.content ?? null;
  let liveError: string | null = null;
  if (!initialContent) {
    const live = await getHomeContent();
    if (live.status === "ok") {
      initialContent = live.content;
    } else {
      liveError = live.message;
    }
  }

  const { sections, designControlled } = buildEditorSections(contentInventory);

  return (
    <main className={styles.page}>
      <div className="container">
        <span className="eyebrow">Haipa Labs · Internal Operator Tool</span>
        <h1 className="section-title">Draft Content Editor</h1>
        <p className={styles.intro}>
          Edits are saved as a local <strong>draft</strong> only. Live WordPress
          content is never modified here. Publish approved drafts to the local
          snapshot from the publication controls.
        </p>

        <div className={styles.metaBar}>
          <span>
            Draft:{" "}
            <strong>{draft ? draft.hash : "none"}</strong>
            {draft && ` · saved ${new Date(draft.savedAt).toLocaleString()}`}
          </span>
          <span>
            Published:{" "}
            <strong>{published ? published.hash : "none"}</strong>
            {published &&
              ` · ${new Date(published.publishedAt).toLocaleString()}`}
          </span>
          <Link href="/preview?source=draft" className={styles.link}>
            Preview draft →
          </Link>
          <Link href="/preview?source=published" className={styles.link}>
            Preview published →
          </Link>
          <Link href="/publication-status" className={styles.link}>
            Publication status →
          </Link>
        </div>

        {liveError && (
          <div className={styles.errorBox}>
            Could not load starting content from WordPress: {liveError}
          </div>
        )}

        {initialContent && (
          <EditorForm
            initialContent={initialContent}
            sections={sections}
            designControlled={designControlled}
            publishedContent={published?.content ?? null}
            initialSavedAt={draft?.savedAt ?? null}
            initialHash={draft?.hash ?? null}
            initialPublishedHash={published?.hash ?? null}
            initialPublishedAt={published?.publishedAt ?? null}
          />
        )}
      </div>
    </main>
  );
}
