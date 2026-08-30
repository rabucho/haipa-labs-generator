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
          Design-first website generator · Slices 1–2 (single site, local fixtures, schema
          validation, pure WordPress adapter, reviewable ACF mapping export)
        </p>

        <div className={styles.cards}>
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

          <div className={`${styles.card} ${styles.cardDisabled}`}>
            <h2 className={styles.cardTitle}>Live WordPress Connection</h2>
            <p className={styles.cardBody}>
              Connect a staging WordPress site and test the edit → publish → refresh loop —
              planned for Slice 3.
            </p>
            <span className={styles.cardDisabledLabel}>Coming in Slice 3</span>
          </div>
        </div>
      </div>
    </main>
  );
}