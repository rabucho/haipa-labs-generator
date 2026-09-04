import { NextRequest, NextResponse } from "next/server";
import {
  EDITOR_SITE_KEY,
  editorRepository,
} from "@/lib/editor/draft-store";

/**
 * POST /api/editor/rollback — restores the previous local published snapshot.
 * Requires explicit confirmation via body { confirm: true }. Local/internal
 * only: never calls the live WordPress update API.
 */
export async function POST(req: NextRequest) {
  let confirm = false;
  try {
    const body = (await req.json()) as { confirm?: unknown };
    confirm = body?.confirm === true;
  } catch {
    confirm = false;
  }

  if (!confirm) {
    return NextResponse.json(
      {
        ok: false,
        errors: [
          "Rollback requires explicit confirmation: send { \"confirm\": true }.",
        ],
      },
      { status: 400 }
    );
  }

  const restored = await editorRepository.rollbackPublished(EDITOR_SITE_KEY);
  if (!restored) {
    return NextResponse.json(
      {
        ok: false,
        errors: ["No previous published snapshot is available to roll back to."],
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    hash: restored.hash,
    publishedAt: restored.publishedAt,
  });
}
