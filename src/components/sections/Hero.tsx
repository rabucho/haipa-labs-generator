import React from "react";
import { HomeContent } from "@/types/content";
import styles from "./Hero.module.css";

interface HeroProps {
  content: HomeContent["hero"];
}

export const Hero: React.FC<HeroProps> = ({ content }) => {
  return (
    <section className={styles.hero}>
      <div className={`${styles.container} container`}>
        <div className={styles.textColumn}>
          {content.eyebrow && <span className="eyebrow">{content.eyebrow}</span>}
          <h1 className={styles.title}>{content.title}</h1>
          <p className={styles.body}>{content.body}</p>
          <div className={styles.ctaWrapper}>
            <a href={content.primaryCta.href} className={styles.ctaButton}>
              {content.primaryCta.label}
            </a>
          </div>
        </div>
        {content.image && (
          <div className={styles.imageColumn}>
            <div className={styles.imageWrapper}>
              <img
                src={content.image.url}
                alt={content.image.alt}
                className={styles.image}
                loading="eager"
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
