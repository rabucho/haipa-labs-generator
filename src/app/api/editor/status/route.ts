import { NextResponse } from "next/server";
import {
  EDITOR_SITE_KEY,
  editorRepository,
} from "@/lib/editor/draft-store";

/**
 * GET /api/editor/status — draft/published snapshot status for the internal
 * editor UI: hashes, timestamps, unpublished-changes flag, and rollback
 * availability. Local metadata only; no content bodies, no secrets.
 */
export async function GET() {
  const [draft, published, canRollback] = await Promise.all([
    editorRepository.loadDraft(EDITOR_SITE_KEY),
    editorRepository.loadPublished(EDITOR_SITE_KEY),
    editorRepository.hasRollbackSnapshot(EDITOR_SITE_KEY),
  ]);

  const unpublishedChanges =
    draft !== null && published !== null && draft.hash !== published.hash;

  return NextResponse.json({
    siteKey: EDITOR_SITE_KEY,
    draft: draft ? { hash: draft.hash, savedAt: draft.savedAt } : null,
    published: published
      ? { hash: published.hash, publishedAt: published.publishedAt }
      : null,
    unpublishedChanges,
    canRollback,
  });
}
