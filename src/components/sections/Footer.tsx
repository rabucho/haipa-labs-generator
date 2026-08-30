import React from "react";
import { HomeContent } from "@/types/content";
import styles from "./Footer.module.css";

interface FooterProps {
  content: HomeContent["footer"];
}

export const Footer: React.FC<FooterProps> = ({ content }) => {
  return (
    <footer className={styles.footer}>
      <div className="container">
        <p className={styles.copyright}>{content.copyright}</p>
      </div>
    </footer>
  );
};