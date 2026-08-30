import styles from "./preview.module.css";

export default function Loading() {
  return (
    <main className={styles.loading}>
      <div className="container">
        <span className="eyebrow">Haipa Labs Preview</span>
        <h1 className="section-title">Loading content…</h1>
        <p className={styles.loadingMessage}>
          Fetching the Home page from WordPress (or the local fixture in
          development).
        </p>
      </div>
    </main>
  );
}
