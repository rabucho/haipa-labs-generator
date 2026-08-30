import React from "react";
import { HomeContent } from "@/types/content";
import { Hero } from "./sections/Hero";
import { About } from "./sections/About";
import { Services } from "./sections/Services";
import { Faq } from "./sections/Faq";
import { Contact } from "./sections/Contact";
import { Footer } from "./sections/Footer";

/**
 * HomeTemplate is the single approved renderer for the Home page.
 * It accepts ONLY validated HomeContent — never raw WordPress JSON.
 * Both the fixture (preview) and the WordPress adapter output render
 * through this template, guaranteeing identical layout.
 */
export function HomeTemplate({ content }: { content: HomeContent }) {
  return (
    <main>
      <Hero content={content.hero} />
      <About content={content.about} />
      <Services services={content.services} />
      <Faq faqs={content.faqs} />
      <Contact content={content.contact} />
      <Footer content={content.footer} />
    </main>
  );
}