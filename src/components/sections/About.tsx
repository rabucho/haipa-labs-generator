import React from "react";
import { HomeContent } from "@/types/content";
import styles from "./About.module.css";

interface AboutProps {
  content: HomeContent["about"];
}

export const About: React.FC<AboutProps> = ({ content }) => {
  return (
    <section className={styles.about}>
      <div className="container">
        <div className={styles.layout}>
          <div className={styles.header}>
            {content.eyebrow && <span className="eyebrow">{content.eyebrow}</span>}
            <h2 className="section-title">{content.title}</h2>
          </div>
          <div className={styles.content}>
            <p className={styles.bodyText}>{content.body}</p>
          </div>
        </div>
      </div>
    </section>
  );
};
