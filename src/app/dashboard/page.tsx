import type { Metadata } from "next";
import styles from "./dashboard.module.css";

export const metadata: Metadata = {
  title: "Operator Dashboard — Haipa Labs",
  description: "Haipa Labs operator hub for the design-first website generator.",
};

/**
 * /dashboard — the Haipa Labs operator hub.
 * Slice 1 scope: links to the site preview and the content inventory report.
 * Authentication, multi-tenancy, and publication controls arrive in later slices.
 */
export default function DashboardPage() {
  return (
    <main className={styles.page}>
      <div className="container">
        <span className="eyebrow">Haipa Labs</span>
        <h1 className="section-title">Operator Dashboard</h1>
        <p className={styles.subtitle}>
          Design-first website generator · Slices 1–4 (single site, schema
          validation, live staging WordPress read, reviewable ACF mapping
          export, internal draft editor with local publish + rollback)
        </p>

        <div className={styles.cards}>
          <a href="/projects" className={styles.card}>
            <h2 className={styles.cardTitle}>Client Projects</h2>
            <p className={styles.cardBody}>
              Internal website factory — one project per prospect: brief, template,
              draft, review, and demo export.
            </p>
            <span className={styles.cardLink}>Open projects →</span>
          </a>

          <a href="/preview" className={styles.card}>
            <h2 className={styles.cardTitle}>Site Preview</h2>
            <p className={styles.cardBody}>
              View the generated Home page rendered from validated content (fixture in
              development, WordPress when configured).
            </p>
            <span className={styles.cardLink}>Open preview →</span>
          </a>

          <a href="/inventory" className={styles.card}>
            <h2 className={styles.cardTitle}>Content Inventory</h2>
            <p className={styles.cardBody}>
              Review every editable business field and the design-controlled values locked in
              the approved template.
            </p>
            <span className={styles.cardLink}>Open inventory →</span>
          </a>

          <a href="/mapping-review" className={styles.card}>
            <h2 className={styles.cardTitle}>ACF Mapping Review</h2>
            <p className={styles.cardBody}>
              Review the generated ACF field-group definition and the
              WordPress-to-React mapping report before any future import.
            </p>
            <span className={styles.cardLink}>Open mapping review →</span>
          </a>

          <a href="/editor" className={styles.card}>
            <h2 className={styles.cardTitle}>Draft Editor (internal)</h2>
            <p className={styles.cardBody}>
              Edit content values as a local draft — live WordPress content is
              never modified. Drafts are validated before saving.
            </p>
            <span className={styles.cardLink}>Open editor →</span>
          </a>

          <a href="/publication-status" className={styles.card}>
            <h2 className={styles.cardTitle}>Publication Status</h2>
            <p className={styles.cardBody}>
              Draft/published snapshot hashes, timestamps, unpublished-changes
              state, and confirmed rollback of the local snapshot.
            </p>
            <span className={styles.cardLink}>Open status →</span>
          </a>

          <a href="/diagnostics" className={styles.card}>
            <h2 className={styles.cardTitle}>WordPress Connection</h2>
            <p className={styles.cardBody}>
              Live staging connection status: effective (redacted) configuration,
              the actual ACF response shape, mapping status, and cache settings.
            </p>
            <span className={styles.cardLink}>Open diagnostics →</span>
          </a>
        </div>
      </div>
    </main>
  );
}