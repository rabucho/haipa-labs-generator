import React from "react";
import { HomeContent } from "@/types/content";
import styles from "./Services.module.css";

interface ServicesProps {
  services: HomeContent["services"];
}

export const Services: React.FC<ServicesProps> = ({ services }) => {
  if (!services || services.items.length === 0) return null;

  return (
    <section id="services" className={styles.services}>
      <div className="container">
        <div className={styles.header}>
          {services.eyebrow && <span className="eyebrow">{services.eyebrow}</span>}
          <h2 className="section-title">{services.title}</h2>
        </div>
        <div className={styles.grid}>
          {services.items.map((service) => (
            <div key={service.id} className={styles.card}>
              <h3 className={styles.cardTitle}>{service.title}</h3>
              <p className={styles.cardDescription}>{service.description}</p>
              {service.href && (
                <a href={service.href} className={styles.learnMore}>
                  Learn more <span className={styles.arrow}>→</span>
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};