import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { timingSafeEqual } from "crypto";
import { getRevalidateSecret, REVALIDATE_TAG } from "@/lib/content/server-config";

/**
 * Protected, server-side cache revalidation endpoint (Slice 3).
 *
 * Triggered manually (or by a future WordPress publish webhook) after content
 * changes on staging:
 *
 *   curl -X POST https://<host>/api/revalidate \
 *     -H "x-revalidate-secret: $REVALIDATE_SECRET"
 *
 * Security:
 * - The secret lives ONLY in the server environment (REVALIDATE_SECRET).
 * - The provided secret is compared in constant time and is never logged.
 * - When REVALIDATE_SECRET is unset the endpoint refuses to revalidate (503).
 */

export const dynamic = "force-dynamic";

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf-8");
  const b = Buffer.from(expected, "utf-8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const expected = getRevalidateSecret();
  if (!expected) {
    return NextResponse.json(
      {
        revalidated: false,
        reason:
          "REVALIDATE_SECRET is not configured on the server; revalidation endpoint is disabled.",
      },
      { status: 503 }
    );
  }

  const provided = req.headers.get("x-revalidate-secret") ?? "";
  if (!provided || !secretsMatch(provided, expected)) {
    return NextResponse.json(
      { revalidated: false, reason: "Invalid or missing revalidation secret." },
      { status: 401 }
    );
  }

  // Next.js 16 requires an explicit cacheLife profile; "max" ensures the
  // tagged entries are fully expired and refetched on the next request.
  revalidateTag(REVALIDATE_TAG, "max");
  return NextResponse.json({
    revalidated: true,
    tag: REVALIDATE_TAG,
    note: "The next request to /preview will fetch fresh WordPress content.",
  });
}

export async function GET() {
  return NextResponse.json(
    {
      endpoint: "/api/revalidate",
      method: "POST",
      header: "x-revalidate-secret",
      note: "Server-side only. The secret value is never exposed here.",
    },
    { status: 200 }
  );
}
