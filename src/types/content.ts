import { z } from "zod";

export const ImageSchema = z.object({
  url: z.string().url("Must be a valid URL"),
  alt: z.string().max(160, "Alt text must be 160 characters or less"),
});

export const LinkSchema = z.object({
  label: z.string().max(60, "Button text must be 60 characters or less"),
  href: z.string().max(500, "URL must be 500 characters or less"),
});

export const ServiceItemSchema = z.object({
  id: z.string(),
  title: z.string().max(100, "Service title must be 100 characters or less"),
  description: z.string().max(500, "Service description must be 500 characters or less"),
  href: z.string().max(500, "Service link must be 500 characters or less").optional(),
});

export const FaqItemSchema = z.object({
  id: z.string(),
  question: z.string().max(200, "FAQ question must be 200 characters or less"),
  answer: z.string().max(1000, "FAQ answer must be 1000 characters or less"),
});

/**
 * Required business fields use `.min(1)` so missing or empty values FAIL
 * validation instead of silently receiving generic copy. Only genuinely
 * optional fields (eyebrows, address, optional links, hero image) may be
 * empty or defaulted by the adapter.
 */
export const HomeContentSchema = z.object({
  hero: z.object({
    eyebrow: z.string().max(120, "Eyebrow must be 120 characters or less"),
    title: z.string().min(1, "Hero title is required").max(120, "Title must be 120 characters or less"),
    body: z.string().min(1, "Hero body is required").max(600, "Body must be 600 characters or less"),
    primaryCta: LinkSchema,
    image: ImageSchema.nullable(),
  }),
  about: z.object({
    eyebrow: z.string().max(120, "About eyebrow must be 120 characters or less"),
    title: z.string().min(1, "About title is required").max(120, "About title must be 120 characters or less"),
    body: z.string().min(1, "About body is required").max(1000, "About body must be 1000 characters or less"),
  }),
  services: z.object({
    eyebrow: z.string().max(120, "Services eyebrow must be 120 characters or less"),
    title: z.string().min(1, "Services title is required").max(120, "Services title must be 120 characters or less"),
    items: z.array(ServiceItemSchema).max(12, "Maximum 12 services allowed"),
  }),
  faqs: z.object({
    eyebrow: z.string().max(120, "FAQs eyebrow must be 120 characters or less"),
    title: z.string().min(1, "FAQs title is required").max(120, "FAQs title must be 120 characters or less"),
    items: z.array(FaqItemSchema).max(20, "Maximum 20 FAQs allowed"),
  }),
  contact: z.object({
    title: z.string().min(1, "Contact title is required").max(120, "Contact title must be 120 characters or less"),
    phone: z.string().min(1, "Contact phone is required").max(40, "Phone must be 40 characters or less"),
    email: z.string().min(1, "Contact email is required").email("Must be a valid email address").max(100, "Email must be 100 characters or less"),
    address: z.string().max(300, "Address must be 300 characters or less"),
  }),
  footer: z.object({
    copyright: z.string().min(1, "Footer copyright is required").max(200, "Copyright must be 200 characters or less"),
  }),
});

export type HomeContent = z.infer<typeof HomeContentSchema>;