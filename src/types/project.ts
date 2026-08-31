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
export type ProjectWordPressConnection = {
  apiUrl: string;
  pageId?: string;
  pageSlug?: string;
  connectedAt?: string;
};

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
  wordpressConnection: z
    .object({
      apiUrl: z.string().url(),
      pageId: z.string().optional(),
      pageSlug: z.string().optional(),
      connectedAt: z.string().datetime().optional(),
    })
    .optional(),
});
