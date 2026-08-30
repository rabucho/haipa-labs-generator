import React from "react";
import { HomeContent } from "@/types/content";
import styles from "./Contact.module.css";

interface ContactProps {
  content: HomeContent["contact"];
}

export const Contact: React.FC<ContactProps> = ({ content }) => {
  return (
    <section id="contact" className={styles.contact}>
      <div className="container">
        <div className={styles.layout}>
          <div className={styles.header}>
            <h2 className="section-title">{content.title}</h2>
          </div>
          <div className={styles.details}>
            <div>
              <span className={styles.detailLabel}>Phone</span>
              <a href={`tel:${content.phone.replace(/\s/g, "")}`} className={styles.detailValue}>
                {content.phone}
              </a>
            </div>
            <div>
              <span className={styles.detailLabel}>Email</span>
              <a href={`mailto:${content.email}`} className={styles.detailValue}>
                {content.email}
              </a>
            </div>
            {content.address && (
              <div>
                <span className={styles.detailLabel}>Address</span>
                <p className={styles.detailValue}>{content.address}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};