import "server-only";

import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { isValidProjectId } from "./project-repository";

/**
 * Project-scoped brief repository (Slice 6) — server-only.
 *
 * PERSISTENCE (dev-only): `.data/projects/<projectId>/brief.json` (gitignored).
 * The repository interface keeps the future database upgrade local. Every
 * method validates the project id first, so one project can never read or
 * write another project's brief.
 */

export const ContactDetailsSchema = z.object({
  phone: z.string().max(40).optional(),
  email: z.string().max(120).optional(),
  address: z.string().max(300).optional(),
  website: z.string().max(300).optional(),
});

/**
 * Required: businessName, industry, offer. Optional fields stay optional and
 * are NEVER auto-filled with invented data by the generator or this schema.
 */
export const BrandBriefSchema = z.object({
  businessName: z.string().min(1, "Business name is required").max(120),
  industry: z.string().min(1, "Industry is required").max(80),
  offer: z
    .string()
    .min(1, "Describe what the business offers")
    .max(2000, "Offer must be 2000 characters or less"),
  location: z.string().max(120).optional(),
  audience: z.string().max(600).optional(),
  differentiators: z.string().max(1200).optional(),
  tone: z.string().max(200).optional(),
  primaryGoal: z.string().max(400).optional(),
  contactDetails: ContactDetailsSchema.optional(),
});

export type ValidatedBrandBrief = z.infer<typeof BrandBriefSchema>;

export interface BriefRepository {
  loadBrief(projectId: string): Promise<ValidatedBrandBrief | null>;
  saveBrief(
    projectId: string,
    brief: ValidatedBrandBrief
  ): Promise<ValidatedBrandBrief>;
}

export class JsonFileBriefRepository implements BriefRepository {
  private briefFile(projectId: string): string {
    if (!isValidProjectId(projectId)) {
      throw new Error(`Invalid project id: ${projectId}`);
    }
    return path.join(
      process.env.PROJECTS_DATA_DIR ?? ".data",
      "projects",
      projectId,
      "brief.json"
    );
  }

  async loadBrief(projectId: string): Promise<ValidatedBrandBrief | null> {
    try {
      const raw = await fs.readFile(this.briefFile(projectId), "utf-8");
      const parsed = BrandBriefSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async saveBrief(
    projectId: string,
    brief: ValidatedBrandBrief
  ): Promise<ValidatedBrandBrief> {
    const parsed = BrandBriefSchema.safeParse(brief);
    if (!parsed.success) {
      throw new Error(
        `Brief failed validation: ${parsed.error.errors
          .map((e) => `Path [${e.path.join(".")}]: ${e.message}`)
          .join("; ")}`
      );
    }
    const file = this.briefFile(projectId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(parsed.data, null, 2), "utf-8");
    return parsed.data;
  }
}

export const briefRepository: BriefRepository = new JsonFileBriefRepository();
