/**
 * Typed shapes for raw WordPress REST API responses.
 *
 * These types describe the EXTERNAL WordPress/ACF format. They must only be
 * referenced inside the content adapter (src/lib/content/wordpress.ts).
 * React components must never import or use these types.
 */

export type WordPressImageValue =
  | string
  // ACF image fields using the "ID" return format expose a numeric
  // attachment id in REST responses; the adapter normalizes these to null
  // (the approved field definition uses "array" format instead).
  | number
  | { url?: unknown; alt?: unknown; title?: unknown }
  | null
  | undefined;

export type WordPressServiceRow = {
  id?: unknown;
  services_title?: unknown;
  services_description?: unknown;
  services_url?: unknown;
};

export type WordPressFaqRow = {
  id?: unknown;
  faqs_question?: unknown;
  faqs_answer?: unknown;
};

export type WordPressAcfFields = {
  hero_eyebrow?: unknown;
  hero_title?: unknown;
  hero_text?: unknown;
  hero_button_text?: unknown;
  hero_button_url?: unknown;
  hero_image?: WordPressImageValue;
  about_eyebrow?: unknown;
  about_title?: unknown;
  about_text?: unknown;
  services_section_eyebrow?: unknown;
  services_section_title?: unknown;
  services?: unknown;
  faqs_section_eyebrow?: unknown;
  faqs_section_title?: unknown;
  faqs?: unknown;
  contact_title?: unknown;
  contact_phone?: unknown;
  contact_email?: unknown;
  contact_address?: unknown;
  footer_copyright?: unknown;
};

export type WordPressPageResponse = {
  id?: unknown;
  slug?: unknown;
  title?: { rendered?: unknown };
  acf?: WordPressAcfFields;
};