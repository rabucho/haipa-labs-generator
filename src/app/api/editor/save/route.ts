import { NextRequest, NextResponse } from "next/server";
import { EDITOR_SITE_KEY, editorRepository } from "@/lib/editor/draft-store";
import { validateEditorDraft } from "@/lib/editor/validate-draft";

/**
 * POST /api/editor/save — validates and persists an internal operator draft.
 * NEVER calls the WordPress update API; live WordPress content is untouched.
 * Unknown field names are rejected; invalid drafts never overwrite the last
 * saved draft.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, errors: ["Request body must be valid JSON."] },
      { status: 400 }
    );
  }

  const result = validateEditorDraft(body);
  if (!result.ok) {
    return NextResponse.json({ ok: false, errors: result.errors }, { status: 400 });
  }

  const snapshot = await editorRepository.saveDraft(
    EDITOR_SITE_KEY,
    result.content
  );
  return NextResponse.json({
    ok: true,
    hash: snapshot.hash,
    savedAt: snapshot.savedAt,
  });
}
