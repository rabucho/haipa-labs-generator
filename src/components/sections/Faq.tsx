import React from "react";
import { HomeContent } from "@/types/content";
import styles from "./Faq.module.css";

interface FaqProps {
  faqs: HomeContent["faqs"];
}

export const Faq: React.FC<FaqProps> = ({ faqs }) => {
  if (!faqs.items || faqs.items.length === 0) return null;

  return (
    <section id="faqs" className={styles.faqs}>
      <div className="container">
        <div className={styles.header}>
          {faqs.eyebrow && <span className="eyebrow">{faqs.eyebrow}</span>}
          <h2 className="section-title">{faqs.title}</h2>
        </div>
        <div className={styles.list}>
          {faqs.items.map((faq) => (
            <details key={faq.id} className={styles.item}>
              <summary className={styles.question}>{faq.question}</summary>
              <p className={styles.answer}>{faq.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
};