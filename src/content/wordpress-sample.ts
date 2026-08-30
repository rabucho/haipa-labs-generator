import type { WordPressPageResponse } from "@/types/wordpress";

/**
 * A realistic raw WordPress REST API page response used for offline adapter
 * testing. This mirrors the external ACF format — it must never be imported
 * by React components, only by the adapter and its tests.
 */
export const wordpressSampleResponse: WordPressPageResponse = {
  id: 42,
  slug: "home",
  title: {
    rendered: "Home",
  },
  acf: {
    hero_eyebrow: "M-Pesa integrated cloud systems",
    hero_title: "Powering Kenya's modern digital service sectors",
    hero_text: "We engineer enterprise systems, APIs, and client-facing interfaces that work smoothly even in challenging bandwidth environments.",
    hero_button_text: "Get in touch today",
    hero_button_url: "/contact",
    hero_image: {
      url: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80",
      alt: "A high tech abstract background representing cloud systems",
    },
    about_eyebrow: "Our commitment",
    about_title: "Technically advanced systems, locally optimized",
    about_text: "Our solutions are lightweight and responsive. We use high-performance caching and optimized image loading to ensure your clients can load your pages on any network.",
    services_section_eyebrow: "What we deliver",
    services_section_title: "Engineering services built for scale",
    services: [
      {
        services_title: "Custom CRM & Cloud Database Systems",
        services_description: "Connect your client operations and record-keeping with high-performance Postgres relational databases.",
        services_url: "/services/databases",
      },
      {
        services_title: "API Design & Mobile Payments integration",
        services_description: "Seamlessly integrate Safaricom M-Pesa Express, C2B, and B2C payment pipelines into your existing backend.",
        services_url: "/services/payments",
      },
    ],
    faqs_section_eyebrow: "Answers",
    faqs_section_title: "Frequently asked questions",
    faqs: [
      {
        faqs_question: "Do you build custom mobile apps?",
        faqs_answer: "Yes, we build lightweight mobile apps utilizing Flutter or React Native that connect directly to our headless WordPress and custom APIs.",
      },
      {
        faqs_question: "Where are your servers hosted?",
        faqs_answer: "We deploy secure server networks on Amazon Web Services (AWS) Cape Town region to guarantee low-latency connections across East Africa.",
      },
    ],
    contact_title: "Start building with Amani Tech Consulting",
    contact_phone: "+254 711 222 333",
    contact_email: "contact@amanitech.co.ke",
    contact_address: "Pinetree Plaza, Kaburu Drive, Nairobi, Kenya",
    footer_copyright: "© 2026 Amani Tech Consulting Limited. Locally Engineered.",
  },
};