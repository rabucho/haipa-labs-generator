import "server-only";

import type { AuthContext } from "@/lib/auth/session";
import { getScopedRepositories } from "@/lib/auth/guards";
import { projectDraftRepository } from "@/lib/projects/draft-repository";
import { hashContent } from "@/lib/editor/draft-store";
import { getReadyTemplate } from "@/lib/templates/registry";
import { SITE_CONTENT_SCHEMA_VERSION, siteContentFromHomeContent } from "@/types/pages";
import { reviewMarkersByPage } from "@/lib/templates/page-inventory";

/**
 * Explicit SiteContent 1.0 → 2.0 migration (Slice 13, Stage C).
 *
 * The stored draft format remains HomeContent; the v2 SiteContent envelope is
 * derived. Migration therefore produces a NEW review-status draft snapshot
 * (never mutating the legacy draft), is idempotent via a deterministic
 * content-hash marker, and never contacts WordPress.
 */

export const MIGRATION_MARKER_PREFIX = "site-content-v2-migration:";

export type MigrationPreview = {
  sourceSchemaVersion: "1.0";
  targetSchemaVersion: string;
  sourceDraftId: string | null;
  sourceHash: string;
  pages: Array<{ pageKey: string; fields: number }>;
  reviewMarkers: Array<{ pageKey: string; path: string }>;
  warnings: string[];
  alreadyMigrated: boolean;
};

export type MigrationResult =
  | {
      ok: true;
      migrated: boolean;
      alreadyMigrated: boolean;
      draftId: string;
      preview: MigrationPreview;
    }
  | { ok: false; errors: string[] };

async function loadMigrationContext(auth: AuthContext, projectId: string) {
  const access = await getScopedRepositories(auth).projects;
  const project = await access.loadProject(projectId);
  if (!project) return null;
  const template = getReadyTemplate(project.templateId);
  if (!template) return null;
  const drafts = await projectDraftRepository.listDrafts(projectId);
  const source = drafts.find((d) => d.approved) ?? drafts[drafts.length - 1] ?? null;
  if (!source) return null;
  const sourceHash = hashContent(source.content);
  return { project, template, drafts, source, sourceHash };
}

/** READ-ONLY preview: no mutation, no WordPress calls. */
export async function migrationPreview(
  auth: AuthContext,
  projectId: string
): Promise<
  | { ok: true; preview: MigrationPreview; nothingToMigrate: boolean }
  | { ok: false; errors: string[] }
> {
  const ctx = await loadMigrationContext(auth, projectId);
  if (!ctx) {
    return { ok: false, errors: ["Project not found or has no draft to migrate."] };
  }
  const { template, drafts, source, sourceHash } = ctx;
  const alreadyMigrated = drafts.some(
    (d) => d.aiPromptVersion === `${MIGRATION_MARKER_PREFIX}${sourceHash}`
  );
  const site = siteContentFromHomeContent(source.content, template.id, template.version);
  const markers = reviewMarkersByPage(source.content);
  const preview: MigrationPreview = {
    sourceSchemaVersion: "1.0",
    targetSchemaVersion: SITE_CONTENT_SCHEMA_VERSION,
    sourceDraftId: source.id,
    sourceHash,
    pages: [
      { pageKey: "home", fields: 7 },
      { pageKey: "about", fields: 3 },
      { pageKey: "services", fields: 2 + site.pages.services.items.length * 3 },
      { pageKey: "faqs", fields: 1 + site.pages.faqs.items.length * 2 },
      { pageKey: "contact", fields: 4 },
    ],
    reviewMarkers: markers,
    warnings: [
      ...(markers.length > 0
        ? [`${markers.length} field(s) carry [For review] markers — complete them before syncing to staging.`]
        : []),
      "The original legacy draft is preserved unchanged; migration creates a new review draft.",
    ],
    alreadyMigrated,
  };
  return { ok: true, preview, nothingToMigrate: false };
}

/** Execute: create a NEW review draft derived from the legacy draft. Idempotent. */
export async function executeMigration(
  auth: AuthContext,
  projectId: string
): Promise<MigrationResult> {
  const ctx = await loadMigrationContext(auth, projectId);
  if (!ctx) {
    return { ok: false, errors: ["Project not found or has no draft to migrate."] };
  }
  const { template, drafts, source, sourceHash } = ctx;
  const marker = `${MIGRATION_MARKER_PREFIX}${sourceHash}`;

  // Idempotent: skip if this exact source was already migrated.
  const existing = drafts.find((d) => d.aiPromptVersion === marker);
  if (existing) {
    return {
      ok: true,
      migrated: false,
      alreadyMigrated: true,
      draftId: existing.id,
      preview: {
        sourceSchemaVersion: "1.0",
        targetSchemaVersion: SITE_CONTENT_SCHEMA_VERSION,
        sourceDraftId: source.id,
        sourceHash,
        pages: [],
        reviewMarkers: reviewMarkersByPage(source.content),
        warnings: ["This draft content was already migrated; the existing review draft is reused."],
        alreadyMigrated: true,
      },
    };
  }

  const draft = await projectDraftRepository.createDraft({
    projectId,
    templateId: template.id,
    content: source.content,
    source: "manual",
    aiPromptVersion: marker,
  });
  return {
    ok: true,
    migrated: true,
    alreadyMigrated: false,
    draftId: draft.id,
    preview: {
      sourceSchemaVersion: "1.0",
      targetSchemaVersion: SITE_CONTENT_SCHEMA_VERSION,
      sourceDraftId: source.id,
      sourceHash,
      pages: [],
      reviewMarkers: reviewMarkersByPage(source.content),
      warnings: [],
      alreadyMigrated: false,
    },
  };
}
