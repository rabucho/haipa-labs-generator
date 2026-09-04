import { NextRequest, NextResponse } from "next/server";
import { CreateProjectInputSchema } from "@/types/project";
import { projectRepository } from "@/lib/projects/project-repository";
import { getReadyTemplate } from "@/lib/templates/registry";

/**
 * Internal projects API (Slice A).
 * GET  /api/projects — list projects.
 * POST /api/projects — create a project from a brief-shaped input; the
 * templateId must reference a READY template in the registry.
 */
export async function GET() {
  const projects = await projectRepository.listProjects();
  return NextResponse.json({ projects });
}

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

  const parsed = CreateProjectInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        errors: parsed.error.errors.map(
          (e) => `Path [${e.path.join(".") || "(root)"}]: ${e.message}`
        ),
      },
      { status: 400 }
    );
  }

  const template = getReadyTemplate(parsed.data.templateId);
  if (!template) {
    return NextResponse.json(
      {
        ok: false,
        errors: [
          `Unknown or not-yet-available template: ${parsed.data.templateId}`,
        ],
      },
      { status: 400 }
    );
  }

  const project = await projectRepository.createProject(parsed.data);
  return NextResponse.json({ ok: true, project }, { status: 201 });
}
