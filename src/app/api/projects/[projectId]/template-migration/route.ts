import { NextRequest, NextResponse } from "next/server";
import {
  authErrorResponse,
  requireAuthenticatedOperator,
  requireProjectAccess,
} from "@/lib/auth/guards";
import { isValidProjectId } from "@/lib/projects/project-repository";
import {
  buildMigrationPlan,
  executeMigration,
  migrateAssignment,
  rollbackMigration,
  buildDemoPackage,
} from "@/lib/projects/template-migration";

/**
 * Slice 17 — explicit project template migration + demo package.
 *
 * GET  /api/projects/<id>/template-migration?target=<versionId>
 *      Read-only compatibility plan. Zero network calls.
 * POST /api/projects/<id>/template-migration
 *      body: { action: "execute" | "migrate-assignment" | "rollback",
 *              targetVersionId?, planHash?, migrationId?, confirm }
 *
 * GET  /api/projects/<id>/demo-package — internal demo snapshot (safe refs).
 */
type RouteParams = { params: Promise<{ projectId: string }> };

export async function GET(
  req: NextRequest,
  { params }: RouteParams
) {
  try {
    const auth = await requireAuthenticatedOperator();
    const { projectId } = await params;
    if (!isValidProjectId(projectId)) {
      return NextResponse.json({ ok: false, errors: ["Invalid project id."] }, { status: 400 });
    }
    const access = await requireProjectAccess(auth, projectId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, errors: ["Project not found."] }, { status: 404 });
    }

    if (req.nextUrl.searchParams.get("demo") === "true") {
      const pkg = await buildDemoPackage(auth, projectId);
      return NextResponse.json(pkg, { status: pkg.ok ? 200 : 404 });
    }

    const target = req.nextUrl.searchParams.get("target");
    if (!target) {
      return NextResponse.json(
        { ok: false, errors: ["Provide ?target=<versionId> for a migration plan, or ?demo=true."] },
        { status: 400 }
      );
    }
    const plan = await buildMigrationPlan(auth, projectId, target);
    return NextResponse.json(plan, { status: plan.ok ? 200 : 404 });
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    return NextResponse.json({ ok: false, errors: ["Migration plan failed safely."] }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const auth = await requireAuthenticatedOperator();
    const { projectId } = await params;
    if (!isValidProjectId(projectId)) {
      return NextResponse.json({ ok: false, errors: ["Invalid project id."] }, { status: 400 });
    }
    const access = await requireProjectAccess(auth, projectId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, errors: ["Project not found."] }, { status: 404 });
    }

    let body: {
      action?: string;
      targetVersionId?: string;
      planHash?: string;
      migrationId?: string;
      confirm?: boolean;
    } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ ok: false, errors: ["Invalid JSON body."] }, { status: 400 });
    }

    switch (body.action) {
      case "execute": {
        if (!body.targetVersionId || !body.planHash) {
          return NextResponse.json(
            { ok: false, errors: ["execute requires targetVersionId and planHash."] },
            { status: 400 }
          );
        }
        const r = await executeMigration(
          auth,
          projectId,
          body.targetVersionId,
          body.planHash,
          body.confirm === true
        );
        return NextResponse.json(r, { status: r.ok ? 200 : 409 });
      }
      case "migrate-assignment": {
        if (!body.migrationId) {
          return NextResponse.json(
            { ok: false, errors: ["migrate-assignment requires migrationId."] },
            { status: 400 }
          );
        }
        const r = await migrateAssignment(auth, projectId, body.migrationId, body.confirm === true);
        return NextResponse.json(r, { status: r.ok ? 200 : 409 });
      }
      case "rollback": {
        if (!body.migrationId) {
          return NextResponse.json(
            { ok: false, errors: ["rollback requires migrationId."] },
            { status: 400 }
          );
        }
        const r = await rollbackMigration(auth, projectId, body.migrationId, body.confirm === true);
        return NextResponse.json(r, { status: r.ok ? 200 : 409 });
      }
      default:
        return NextResponse.json({ ok: false, errors: ["Unknown action."] }, { status: 400 });
    }
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    return NextResponse.json({ ok: false, errors: ["Migration action failed safely."] }, { status: 500 });
  }
}
