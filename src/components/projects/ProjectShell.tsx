import React from "react";
import Link from "next/link";
import type { WebsiteProject } from "@/types/project";
import { getTemplate } from "@/lib/templates/registry";
import styles from "./project-shell.module.css";

/**
 * Shared shell for project-scoped pages: header, step navigation with
 * slice availability, and a body slot. Keeps every project page visually
 * consistent as later slices fill in the steps.
 */

export type ProjectStepKey =
  | "workspace"
  | "brief"
  | "media"
  | "template"
  | "generate"
  | "preview"
  | "review"
  | "inventory"
  | "exports";

const STEPS: Array<{
  key: ProjectStepKey;
  label: string;
  /** Route segment ("" = workspace root). */
  segment: string;
  available: boolean;
  sliceLabel?: string;
}> = [
  { key: "workspace", label: "Workspace", segment: "", available: true },
  { key: "brief", label: "Brief", segment: "brief", available: true },
  { key: "media", label: "Media", segment: "media", available: true },
  { key: "template", label: "Template", segment: "template", available: true },
  { key: "generate", label: "Generate", segment: "generate", available: true },
  { key: "preview", label: "Preview", segment: "preview", available: true },
  { key: "review", label: "Review", segment: "review", available: true },
  { key: "inventory", label: "Inventory", segment: "inventory", available: false, sliceLabel: "Slice 7" },
  { key: "exports", label: "Exports", segment: "exports", available: false, sliceLabel: "Slice 7" },
];

export default function ProjectShell({
  project,
  activeStep,
  children,
}: {
  project: WebsiteProject;
  activeStep: ProjectStepKey;
  children: React.ReactNode;
}) {
  const template = getTemplate(project.templateId);
  const statusClass =
    styles[`status-${project.status}`] ?? styles.statusBadge;

  return (
    <main className={styles.page}>
      <div className="container">
        <span className="eyebrow">Haipa Labs · Internal Project</span>
        <h1 className="section-title">{project.name}</h1>
        <p className={styles.meta}>
          Prospect: <strong>{project.prospectName}</strong> · Industry:{" "}
          {project.industry}
          {project.location ? ` · ${project.location}` : ""} · Template:{" "}
          {template?.name ?? project.templateId} ·{" "}
          <span className={statusClass}>{project.status}</span> · Updated{" "}
          {new Date(project.updatedAt).toLocaleString()}
        </p>

        <nav className={styles.steps} aria-label="Project steps">
          {STEPS.map((step) => {
            const href = `/projects/${project.id}${step.segment ? `/${step.segment}` : ""}`;
            const isActive = step.key === activeStep;
            if (!step.available) {
              return (
                <span
                  key={step.key}
                  className={`${styles.step} ${styles.stepDisabled}`}
                  aria-disabled="true"
                >
                  {step.label}
                  <small> ({step.sliceLabel})</small>
                </span>
              );
            }
            return (
              <Link
                key={step.key}
                href={href}
                className={`${styles.step} ${isActive ? styles.stepActive : ""}`}
                aria-current={isActive ? "page" : undefined}
              >
                {step.label}
              </Link>
            );
          })}
        </nav>

        <div className={styles.body}>{children}</div>
      </div>
    </main>
  );
}
