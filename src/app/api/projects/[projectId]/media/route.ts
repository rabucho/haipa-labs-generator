import { NextRequest, NextResponse } from "next/server";
import { projectRepository, isValidProjectId } from "@/lib/projects/project-repository";
import {
  BrandMediaInputSchema,
  mediaRepository,
} from "@/lib/projects/media-repository";

/**
 * Project media API (Slice 6) — metadata + safe references only, scoped to
 * one project. No object storage, no remote fetching, no document parsing.
 * GET    /api/projects/<projectId>/media              — list
 * POST   /api/projects/<projectId>/media              — add (validated)
 * PATCH  /api/projects/<projectId>/media?mediaId=...  — toggle approval
 * DELETE /api/projects/<projectId>/media?mediaId=...  — remove
 */
type RouteParams = { params: Promise<{ projectId: string }> };

async function resolveProject(projectId: string) {
  if (!isValidProjectId(projectId)) return null;
  return projectRepository.loadProject(projectId);
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { projectId } = await params;
  const project = await resolveProject(projectId);
  if (!project) {
    return NextResponse.json(
      { ok: false, errors: ["Project not found."] },
      { status: 404 }
    );
  }
  const media = await mediaRepository.listMedia(projectId);
  return NextResponse.json({ ok: true, media });
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { projectId } = await params;
  const project = await resolveProject(projectId);
  if (!project) {
    return NextResponse.json(
      { ok: false, errors: ["Project not found."] },
      { status: 404 }
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, errors: ["Request body must be valid JSON."] },
      { status: 400 }
    );
  }
  const parsed = BrandMediaInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        errors: parsed.error.errors.map(
          (e) => `${e.path.join(".") || "(root)"}: ${e.message}`
        ),
      },
      { status: 400 }
    );
  }
  try {
    const record = await mediaRepository.addMedia(projectId, parsed.data);
    return NextResponse.json({ ok: true, media: record }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, errors: [error instanceof Error ? error.message : String(error)] },
      { status: 400 }
    );
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { projectId } = await params;
  const project = await resolveProject(projectId);
  if (!project) {
    return NextResponse.json(
      { ok: false, errors: ["Project not found."] },
      { status: 404 }
    );
  }
  const mediaId = new URL(req.url).searchParams.get("mediaId") ?? "";
  const approved = new URL(req.url).searchParams.get("approved") === "true";
  if (!mediaId) {
    return NextResponse.json(
      { ok: false, errors: ["mediaId query parameter is required."] },
      { status: 400 }
    );
  }
  const updated = await mediaRepository.setApproved(projectId, mediaId, approved);
  if (!updated) {
    return NextResponse.json(
      { ok: false, errors: ["Media not found in this project."] },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true, media: updated });
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const { projectId } = await params;
  const project = await resolveProject(projectId);
  if (!project) {
    return NextResponse.json(
      { ok: false, errors: ["Project not found."] },
      { status: 404 }
    );
  }
  const mediaId = new URL(req.url).searchParams.get("mediaId") ?? "";
  if (!mediaId) {
    return NextResponse.json(
      { ok: false, errors: ["mediaId query parameter is required."] },
      { status: 400 }
    );
  }
  const removed = await mediaRepository.removeMedia(projectId, mediaId);
  if (!removed) {
    return NextResponse.json(
      { ok: false, errors: ["Media not found in this project."] },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}
