import { HomeContent } from "@/types/content";

export const homeFixture: HomeContent = {
  hero: {
    eyebrow: "Digital systems for progressive enterprises",
    title: "Engineering bespoke software solutions for African businesses",
    body: "We partner with established companies and growing startups to design, build, and deploy reliable digital platforms that streamline operations and accelerate growth.",
    primaryCta: {
      label: "Schedule a consultation",
      href: "/contact",
    },
    image: {
      url: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1200&q=80",
      alt: "A professional engineering team working collaboratively in a modern workspace.",
    },
  },
  about: {
    eyebrow: "Our core philosophy",
    title: "Committed to technical excellence and local context",
    body: "Founded with the mission to build robust infrastructure for the modern African digital economy, we combine global software engineering standards with deep local operational insights. Our designs are performant, accessible, and resilient.",
  },
  services: {
    eyebrow: "Our expertise",
    title: "Professional capabilities",
    items: [
      {
        id: "srv_1",
        title: "Enterprise Software Development",
        description: "Scale your operations with custom cloud-native platforms, secure APIs, and robust database architectures designed to meet high transaction volumes.",
        href: "/services/enterprise",
      },
      {
        id: "srv_2",
        title: "Digital Product Design",
        description: "From research to interactive prototypes, we design mobile and web interfaces optimized for African networks, devices, and user behaviors.",
        href: "/services/design",
      },
      {
        id: "srv_3",
        title: "System Integration",
        description: "Seamlessly connect your legacy databases with mobile payment channels like M-Pesa, SMS gateways, and modern cloud CRM solutions.",
        href: "/services/integrations",
      },
    ],
  },
  faqs: {
    eyebrow: "Common questions",
    title: "Frequently asked questions",
    items: [
      {
        id: "faq_1",
        question: "What industries do you specialize in?",
        answer: "We primarily support companies in agriculture, fintech, logistics, and professional service sectors who require custom integrations and resilient backend infrastructure.",
      },
      {
        id: "faq_2",
        question: "How do you handle project management?",
        answer: "We follow an agile methodology with two-week sprints. Clients receive access to a staging environment where they can review progress in real-time.",
      },
      {
        id: "faq_3",
        question: "Do you offer post-launch technical support?",
        answer: "Yes, we provide ongoing maintenance level agreements (SLAs), including server monitoring, security patching, and incremental content updates.",
      },
    ],
  },
  contact: {
    title: "Let's discuss your engineering requirements",
    phone: "+254 700 000 000",
    email: "consulting@amanitech.co.ke",
    address: "Galana Road, Kilimani, Nairobi, Kenya",
  },
  footer: {
    copyright: "© 2026 Amani Tech Consulting. All rights reserved.",
  },
};