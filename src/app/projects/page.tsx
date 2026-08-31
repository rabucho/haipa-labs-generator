import type { Metadata } from "next";
import Link from "next/link";
import { projectRepository } from "@/lib/projects/project-repository";
import { getTemplate } from "@/lib/templates/registry";
import styles from "./projects.module.css";

export const metadata: Metadata = {
  title: "Projects — Haipa Labs (Internal)",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * /projects — lists internal client projects (one per prospect/eventual
 * client website). Internal tool only.
 */
export default async function ProjectsPage() {
  const projects = await projectRepository.listProjects();

  return (
    <main className={styles.page}>
      <div className="container">
        <span className="eyebrow">Haipa Labs · Internal Website Factory</span>
        <h1 className="section-title">Client Projects</h1>
        <p className={styles.intro}>
          One project per prospect. Create a project, pick a template, generate
          a draft, review it, and export a demo for the pitch.
        </p>

        <div className={styles.toolbar}>
          <Link href="/projects/new" className={styles.primaryButton}>
            + New project
          </Link>
          <Link href="/dashboard" className={styles.link}>
            Back to dashboard
          </Link>
        </div>

        {projects.length === 0 ? (
          <div className={styles.empty}>
            <h2 className={styles.emptyTitle}>No projects yet</h2>
            <p>
              Create your first project to start a brief, pick a template, and
              generate a content draft for a prospect.
            </p>
            <Link href="/projects/new" className={styles.primaryButton}>
              Create your first project
            </Link>
          </div>
        ) : (
          <div className={styles.grid}>
            {projects.map((project) => {
              const template = getTemplate(project.templateId);
              return (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className={styles.card}
                >
                  <div className={styles.cardHeader}>
                    <h2 className={styles.cardTitle}>{project.name}</h2>
                    <span className={styles.statusChip}>
                      {project.status}
                    </span>
                  </div>
                  <p className={styles.cardMeta}>
                    {project.prospectName} · {project.industry}
                    {project.location ? ` · ${project.location}` : ""}
                  </p>
                  <p className={styles.cardMeta}>
                    Template: {template?.name ?? project.templateId}
                  </p>
                  <p className={styles.cardUpdated}>
                    Updated {new Date(project.updatedAt).toLocaleString()}
                  </p>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
