import { NextRequest, NextResponse } from "next/server";
import { isValidProjectId } from "@/lib/projects/project-repository";
import {
  listProviderDescriptors,
  listOpenRouterModels,
  diagnoseProvider,
} from "@/lib/generation/provider-registry";

/**
 * GET /api/projects/<projectId>/generation/providers (Slice 12)
 *
 * Safe provider catalog for the generate page: descriptors with
 * availability/capabilities and the operator note. No credentials, base
 * URLs with keys, prompts, or raw provider responses. OpenRouter model
 * discovery runs only when that provider is enabled, with bounded caching.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  if (!isValidProjectId(projectId)) {
    return NextResponse.json({ ok: false, errors: ["Invalid project id."] }, { status: 400 });
  }

  // Slice 14 Stage A: optional safe per-provider diagnosis (?diagnose=<id>).
  const diagnose = req.nextUrl.searchParams.get("diagnose");
  let diagnosis: Awaited<ReturnType<typeof diagnoseProvider>> | null = null;
  if (diagnose) {
    diagnosis = await diagnoseProvider(diagnose);
  }

  const descriptors = listProviderDescriptors();

  const openRouter = descriptors.find((d) => d.providerId === "openrouter");
  let models: Array<Record<string, unknown>> | null = null;
  let modelsErrorCode: string | null = null;
  if (openRouter?.supportsModelListing && openRouter.availability === "enabled") {
    const result = await listOpenRouterModels();
    if (result.ok) {
      models = result.models.map((m) => ({
        id: m.id,
        name: m.name,
        contextLength: m.contextLength,
        promptPriceLabel: m.promptPriceLabel,
      }));
    } else {
      modelsErrorCode = result.errorCode;
    }
  }

  return NextResponse.json({
    ok: true,
    providers: descriptors,
    openRouterModels: models,
    openRouterModelsErrorCode: modelsErrorCode,
    diagnosis,
  });
}
