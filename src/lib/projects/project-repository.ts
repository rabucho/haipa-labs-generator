import "server-only";

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import {
  ProjectSchema,
  type CreateProjectInput,
  type ProjectStatus,
  type WebsiteProject,
} from "@/types/project";

/**
 * Project repository (Slice A) — server-only.
 *
 * PERSISTENCE (documented, dev-only): one JSON file per project under
 * `PROJECTS_DATA_DIR` (default `.data`, gitignored):
 *   .data/projects/<projectId>/project.json
 * Later slices add sibling files (brief, media, drafts, exports) in the same
 * project directory. The `ProjectRepository` interface exists so this JSON
 * implementation can be replaced with a database without touching callers.
 * There is exactly one internal operator; NO tenant isolation is claimed —
 * but every entity and method is project-scoped so two prospects can never
 * be confused.
 */

// Single source of truth lives in @/types/project so the local and database
// repositories accept exactly the same mutable fields.
export type { ProjectPatch } from "@/types/project";
import type { ProjectPatch } from "@/types/project";

export interface ProjectRepository {
  createProject(input: CreateProjectInput): Promise<WebsiteProject>;
  listProjects(): Promise<WebsiteProject[]>;
  loadProject(projectId: string): Promise<WebsiteProject | null>;
  updateProject(
    projectId: string,
    patch: ProjectPatch
  ): Promise<WebsiteProject | null>;
}

/** Project ids are used in file paths — strictly validate them. */
export function isValidProjectId(projectId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(projectId) && projectId.length <= 80;
}

export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "project";
}

export class JsonFileProjectRepository implements ProjectRepository {
  private baseDir(): string {
    return process.env.PROJECTS_DATA_DIR ?? ".data";
  }

  private projectsRoot(): string {
    return path.join(this.baseDir(), "projects");
  }

  private projectFile(projectId: string): string {
    if (!isValidProjectId(projectId)) {
      throw new Error(`Invalid project id: ${projectId}`);
    }
    return path.join(this.projectsRoot(), projectId, "project.json");
  }

  async createProject(input: CreateProjectInput): Promise<WebsiteProject> {
    const id = `proj_${randomUUID()}`;
    const now = new Date().toISOString();

    // Slugs are unique across projects; derive from the name and de-duplicate.
    const existing = await this.listProjects();
    const baseSlug = slugifyName(input.name);
    let slug = baseSlug;
    let counter = 2;
    while (existing.some((p) => p.slug === slug)) {
      slug = `${baseSlug}-${counter}`;
      counter += 1;
    }

    const project: WebsiteProject = {
      id,
      name: input.name,
      slug,
      prospectName: input.prospectName,
      industry: input.industry,
      ...(input.location ? { location: input.location } : {}),
      status: "brief",
      templateId: input.templateId,
      createdAt: now,
      updatedAt: now,
    };

    const parsed = ProjectSchema.safeParse(project);
    if (!parsed.success) {
      throw new Error(
        `Created project failed validation: ${parsed.error.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join("; ")}`
      );
    }

    const file = this.projectFile(id);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(project, null, 2), "utf-8");
    return project;
  }

  async listProjects(): Promise<WebsiteProject[]> {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(this.projectsRoot(), { withFileTypes: true }).then((dirents) =>
        dirents.filter((d) => d.isDirectory()).map((d) => d.name)
      );
    } catch {
      return [];
    }

    const projects: WebsiteProject[] = [];
    for (const id of entries) {
      if (!isValidProjectId(id)) continue;
      const project = await this.loadProject(id);
      if (project) projects.push(project);
    }
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async loadProject(projectId: string): Promise<WebsiteProject | null> {
    if (!isValidProjectId(projectId)) return null;
    try {
      const raw = await fs.readFile(this.projectFile(projectId), "utf-8");
      const parsed = ProjectSchema.safeParse(JSON.parse(raw));
      return parsed.success ? (parsed.data as WebsiteProject) : null;
    } catch {
      return null;
    }
  }

  async updateProject(
    projectId: string,
    patch: ProjectPatch
  ): Promise<WebsiteProject | null> {
    const current = await this.loadProject(projectId);
    if (!current) return null;

    const updated: WebsiteProject = {
      ...current,
      ...patch,
      id: current.id, // identity fields are immutable
      slug: current.slug,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };

    const parsed = ProjectSchema.safeParse(updated);
    if (!parsed.success) {
      throw new Error(
        `Updated project failed validation: ${parsed.error.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join("; ")}`
      );
    }

    await fs.writeFile(
      this.projectFile(projectId),
      JSON.stringify(updated, null, 2),
      "utf-8"
    );
    return updated;
  }
}

export const projectRepository: ProjectRepository =
  new JsonFileProjectRepository();

/** Convenience for pages: loads a project or returns null for unknown ids. */
export async function loadProjectOrNothing(
  projectId: string
): Promise<WebsiteProject | null> {
  return projectRepository.loadProject(projectId);
}

export type { ProjectStatus };
