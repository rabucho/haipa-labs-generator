import { NextResponse } from "next/server";
import {
  EDITOR_SITE_KEY,
  editorRepository,
} from "@/lib/editor/draft-store";
import { validateEditorDraft } from "@/lib/editor/validate-draft";

/**
 * POST /api/editor/publish — approves the current draft as the local
 * published snapshot. Re-validates the draft; an invalid or missing draft is
 * rejected WITHOUT touching the last known-good published snapshot. Never
 * calls the WordPress update API.
 */
export async function POST() {
  const draft = await editorRepository.loadDraft(EDITOR_SITE_KEY);
  if (!draft) {
    return NextResponse.json(
      { ok: false, errors: ["No draft has been saved yet."] },
      { status: 400 }
    );
  }

  const result = validateEditorDraft(draft.content);
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        errors: [
          "Draft failed validation; the published snapshot is unchanged.",
          ...result.errors,
        ],
      },
      { status: 400 }
    );
  }

  const snapshot = await editorRepository.publishDraft(
    EDITOR_SITE_KEY,
    result.content
  );
  return NextResponse.json({
    ok: true,
    hash: snapshot.hash,
    publishedAt: snapshot.publishedAt,
  });
}
