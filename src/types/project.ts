import { z } from "zod";
import type { HomeContent } from "./content";

/**
 * Internal Haipa Labs website-factory domain models (Slice A).
 *
 * A project represents ONE client prospect (or eventual client website).
 * Every project-owned entity carries `projectId`, and every repository
 * method is project-scoped, so the later database/authentication upgrade
 * does not require rewriting the application. This is an INTERNAL tool:
 * no tenant isolation is claimed, but project separation is enforced in
 * code so two prospects can never be confused.
 */

export type ProjectStatus =
  | "brief"
  | "generating"
  | "draft"
  | "review"
  | "approved"
  | "sold"
  | "archived";

/**
 * WordPress connection attached to a PROJECT/site record (never global app
 * state). Slice A only defines the shape; no credentials are stored here —
 * application-password credentials remain server-side environment
 * configuration and are attached at connection time in a later slice.
 */
/**
 * Project-scoped WordPress staging connection (Slice 11).
 *
 * SAFE METADATA ONLY: the target origin comes from the server allowlist
 * (identified by targetKey) and credentials are referenced by the NAME of a
 * server-side environment variable — never their value. A project can only
 * bind to a page on the allowlisted staging origin, verified server-side.
 */
export type ProjectWordPressConnection = {
  /** Must match the server-side allowlisted staging target key. */
  targetKey: string;
  /** Positive integer WordPress page ID on the staging origin. */
  pageId?: number;
  /** Safe slug of the bound staging page. */
  pageSlug?: string;
  /** Name of the server-side env variable holding the credential. */
  credentialReference: string;
  /** Set server-side only after the bound page was verified to exist. */
  pageVerified?: boolean;
  connectedAt?: string;
  lastDiagnosedAt?: string;
  lastPageVerifiedAt?: string;
  lastReadBackAt?: string;
};

/**
 * Central project patch shape (Slice 9). The local repository re-exports this;
 * the database repository imports it directly from here so both backends
 * accept exactly the same mutable fields.
 */
export type ProjectPatch = Partial<
  Pick<
    WebsiteProject,
    | "name"
    | "status"
    | "industry"
    | "location"
    | "currentDraftId"
    | "approvedDesignVersion"
    | "templateVersionId"
  | "templateVersionId"
    | "wordpressConnection"
  >
>;

export interface WebsiteProject {
  id: string;
  name: string;
  /** URL-safe, unique identifier derived from the name. */
  slug: string;
  prospectName: string;
  industry: string;
  location?: string;
  status: ProjectStatus;
  templateId: string;
  createdAt: string;
  updatedAt: string;
  currentDraftId?: string;
  approvedDesignVersion?: string;
  /** Pinned immutable builder version (Slice 17). Null = registry default. */
  templateVersionId?: string;
  wordpressConnection?: ProjectWordPressConnection;
}

export interface BrandBrief {
  businessName: string;
  industry: string;
  location?: string;
  audience?: string;
  offer?: string;
  differentiators?: string;
  tone?: string;
  primaryGoal?: string;
  contactDetails?: {
    phone?: string;
    email?: string;
    address?: string;
    website?: string;
  };
}

export interface BrandMedia {
  id: string;
  projectId: string;
  kind: "logo" | "photo" | "document" | "reference";
  name: string;
  sourceUrl?: string;
  localPath?: string;
  altText?: string;
  mimeType?: string;
  approved: boolean;
}

export interface GeneratedContentDraft {
  id: string;
  projectId: string;
  templateId: string;
  content: HomeContent;
  source: "fixture" | "ai" | "manual" | "wordpress";
  aiPromptVersion?: string;
  approved: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Zod guard for project creation input (route-level validation). */
export const CreateProjectInputSchema = z.object({
  name: z.string().min(1, "Project name is required").max(120),
  prospectName: z.string().min(1, "Prospect name is required").max(120),
  industry: z.string().min(1, "Industry is required").max(80),
  location: z.string().max(120).optional(),
  templateId: z.string().min(1),
});

export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

/** Zod guard for the persisted project shape. */
export const ProjectSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/, "Invalid project id"),
  name: z.string().min(1).max(120),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Invalid slug"),
  prospectName: z.string().min(1).max(120),
  industry: z.string().min(1).max(80),
  location: z.string().max(120).optional(),
  status: z.enum([
    "brief",
    "generating",
    "draft",
    "review",
    "approved",
    "sold",
    "archived",
  ]),
  templateId: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  currentDraftId: z.string().optional(),
  approvedDesignVersion: z.string().optional(),
  templateVersionId: z.string().max(80).optional(),
  wordpressConnection: z
    .object({
      targetKey: z.literal("staging"),
      pageId: z.number().int().positive().optional(),
      pageSlug: z.string().regex(/^[a-z0-9-_]{1,120}$/).optional(),
      credentialReference: z.string().min(1),
      pageVerified: z.boolean().optional(),
      connectedAt: z.string().datetime().optional(),
      lastDiagnosedAt: z.string().datetime().optional(),
      lastPageVerifiedAt: z.string().datetime().optional(),
      lastReadBackAt: z.string().datetime().optional(),
    })
    .optional(),
});
