import type { Metadata } from "next";
import { contentInventory } from "@/content/content-inventory";
import styles from "./inventory.module.css";

export const metadata: Metadata = {
  title: "Content Inventory — Haipa Labs",
  description: "Editable-content inventory report for the approved Home template.",
};

/**
 * /inventory — the explicit ContentInventory[] report.
 * Lists every candidate editable value from the approved design, plus the
 * design-controlled values that remain locked in React.
 */
export default function InventoryPage() {
  const editable = contentInventory.filter((field) => field.editable);
  const designControlled = contentInventory.filter((field) => !field.editable);

  return (
    <main className={styles.page}>
      <div className="container">
        <span className="eyebrow">Haipa Labs Operator Report</span>
        <h1 className="section-title">Editable-Content Inventory</h1>
        <p className={styles.summary}>
          {editable.length} editable business fields · {designControlled.length} design-controlled
          values · Schema version 1
        </p>

        <h2 className={styles.subheading}>Editable fields</h2>
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Path</th>
                <th>Label</th>
                <th>Type</th>
                <th>Required</th>
                <th>Max length</th>
                <th>WordPress field</th>
                <th>Source component</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {editable.map((field) => (
                <tr key={field.path}>
                  <td className={styles.code}>{field.path}</td>
                  <td>{field.label}</td>
                  <td>{field.type}</td>
                  <td>{field.required ? "Yes" : "No"}</td>
                  <td>{field.maxLength ?? "—"}</td>
                  <td className={styles.code}>{field.wpName}</td>
                  <td>{field.sourceComponent}</td>
                  <td className={styles.notes}>{field.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 className={styles.subheading}>Design-controlled (not editable by clients)</h2>
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Path</th>
                <th>Label</th>
                <th>Controlled by</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {designControlled.map((field) => (
                <tr key={field.path}>
                  <td className={styles.code}>{field.path}</td>
                  <td>{field.label}</td>
                  <td>{field.sourceComponent}</td>
                  <td className={styles.notes}>{field.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}