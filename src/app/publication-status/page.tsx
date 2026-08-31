import type { Metadata } from "next";
import Link from "next/link";
import {
  EDITOR_SITE_KEY,
  editorRepository,
} from "@/lib/editor/draft-store";
import RollbackButton from "./RollbackButton";
import styles from "./publication-status.module.css";

export const metadata: Metadata = {
  title: "Publication Status — Haipa Labs (Internal)",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * /publication-status — INTERNAL operator view of the local draft/published
 * snapshots: hashes, timestamps, unpublished-changes state, and rollback
 * availability. Local/internal only — live WordPress content is never
 * modified from here.
 */
export default async function PublicationStatusPage() {
  const [draft, published, canRollback] = await Promise.all([
    editorRepository.loadDraft(EDITOR_SITE_KEY),
    editorRepository.loadPublished(EDITOR_SITE_KEY),
    editorRepository.hasRollbackSnapshot(EDITOR_SITE_KEY),
  ]);

  const unpublishedChanges =
    draft !== null && published !== null && draft.hash !== published.hash;

  return (
    <main className={styles.page}>
      <div className="container">
        <span className="eyebrow">Haipa Labs · Internal Operator Tool</span>
        <h1 className="section-title">Publication Status</h1>
        <p className={styles.intro}>
          Local editor snapshots only. <strong>Live WordPress content remains
          the production source</strong> until an explicit future publishing
          workflow is implemented — nothing on this page modifies WordPress.
        </p>

        <div className={styles.cards}>
          <div className={styles.card}>
            <h2>Draft</h2>
            {draft ? (
              <>
                <p>
                  Hash: <code className={styles.hash}>{draft.hash}</code>
                </p>
                <p className={styles.meta}>
                  Saved {new Date(draft.savedAt).toLocaleString()}
                </p>
              </>
            ) : (
              <p className={styles.muted}>No draft saved yet.</p>
            )}
            <p className={styles.meta}>
              <Link href="/preview?source=draft">Preview draft →</Link>
            </p>
          </div>

          <div className={styles.card}>
            <h2>Published (local snapshot)</h2>
            {published ? (
              <>
                <p>
                  Hash: <code className={styles.hash}>{published.hash}</code>
                </p>
                <p className={styles.meta}>
                  Published {new Date(published.publishedAt).toLocaleString()}
                </p>
              </>
            ) : (
              <p className={styles.muted}>
                Nothing published yet. Live WordPress content is still the
                production source.
              </p>
            )}
            <p className={styles.meta}>
              <Link href="/preview?source=published">
                Preview published →
              </Link>
            </p>
          </div>

          <div className={styles.card}>
            <h2>State</h2>
            <p>
              {unpublishedChanges ? (
                <>
                  <strong>Draft differs from the published snapshot</strong> —
                  publish the approved draft to update the local snapshot.
                </>
              ) : draft && published ? (
                "Draft and published snapshots are identical."
              ) : (
                "Save a draft to begin."
              )}
            </p>
            <p className={styles.meta}>
              Live WordPress: current production source (read-only here).
            </p>
          </div>
        </div>

        <h2 className={styles.subheading}>Rollback</h2>
        {canRollback ? (
          <>
            <p className={styles.intro}>
              A previous published snapshot is available. Rollback restores it
              as the current local snapshot after explicit confirmation; the
              draft is untouched and <strong>live WordPress is never
              modified</strong>.
            </p>
            <RollbackButton disabled={false} />
          </>
        ) : (
          <p className={styles.muted}>
            No previous published snapshot is available. Rollback becomes
            available after the second publish.
          </p>
        )}
      </div>
    </main>
  );
}
