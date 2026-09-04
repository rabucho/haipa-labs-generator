import { NextRequest, NextResponse } from "next/server";
import { BrandBriefSchema } from "@/lib/projects/brief-repository";
import { projectRepository, isValidProjectId } from "@/lib/projects/project-repository";
import { briefRepository } from "@/lib/projects/brief-repository";

/**
 * Project brief API (Slice 6) — scoped to one project.
 * GET /api/projects/<projectId>/brief — load the saved brief (or null).
 * PUT /api/projects/<projectId>/brief — validate and save the brief.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  if (!isValidProjectId(projectId)) {
    return NextResponse.json({ ok: false, errors: ["Invalid project id."] }, { status: 400 });
  }
  const project = await projectRepository.loadProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, errors: ["Project not found."] }, { status: 404 });
  }
  const brief = await briefRepository.loadBrief(projectId);
  return NextResponse.json({ ok: true, brief });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  if (!isValidProjectId(projectId)) {
    return NextResponse.json({ ok: false, errors: ["Invalid project id."] }, { status: 400 });
  }
  const project = await projectRepository.loadProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, errors: ["Project not found."] }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, errors: ["Request body must be valid JSON."] }, { status: 400 });
  }

  const parsed = BrandBriefSchema.safeParse(body);
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
    const brief = await briefRepository.saveBrief(projectId, parsed.data);
    return NextResponse.json({ ok: true, brief });
  } catch (error) {
    return NextResponse.json(
      { ok: false, errors: [error instanceof Error ? error.message : String(error)] },
      { status: 400 }
    );
  }
}
