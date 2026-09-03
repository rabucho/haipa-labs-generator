import { contentInventory } from "@/content/content-inventory";
import type { ContentInventory } from "@/types/inventory";
import type { PageKey } from "@/types/pages";

/**
 * Page-aware inventory (Slice 13).
 *
 * PURE and deterministic: maps every editable field of the approved Home
 * inventory to its page key. The homepage-only draft stores all sections, so
 * the mapping is structural: hero/footer → home, about → about, etc.
 * Design-controlled values (editable: false) are excluded.
 */

export type PageAwareInventoryField = ContentInventory & { pageKey: PageKey };

function pageForPath(path: string): PageKey | null {
  if (path.startsWith("hero.") || path.startsWith("footer.")) return "home";
  if (path.startsWith("about.")) return "about";
  if (path.startsWith("services")) return "services";
  if (path.startsWith("faqs")) return "faqs";
  if (path.startsWith("contact.")) return "contact";
  return null;
}

/** Every editable field exactly once, annotated with its page key. */
export function buildPageAwareInventory(): PageAwareInventoryField[] {
  const out: PageAwareInventoryField[] = [];
  for (const field of contentInventory) {
    if (!field.editable) continue;
    const pageKey = pageForPath(field.path);
    if (!pageKey) continue;
    out.push({ ...field, pageKey });
  }
  return out;
}

/** `[For review]` marker paths grouped by page, from a validated draft. */
export function reviewMarkersByPage(content: {
  hero: { eyebrow: string; title: string; body: string };
  about: { eyebrow: string; title: string; body: string };
  services: { title: string; items: Array<{ id: string; title: string; description: string }> };
  faqs: { title: string; items: Array<{ id: string; question: string; answer: string }> };
  contact: { title: string; phone: string; email: string; address: string };
  footer: { copyright: string };
}): Array<{ pageKey: PageKey; path: string }> {
  const markers: Array<{ pageKey: PageKey; path: string }> = [];
  const check = (pageKey: PageKey, path: string, value: string) => {
    if (value.includes("[For review]")) markers.push({ pageKey, path });
  };
  check("home", "hero.eyebrow", content.hero.eyebrow);
  check("home", "hero.title", content.hero.title);
  check("home", "hero.body", content.hero.body);
  check("about", "about.eyebrow", content.about.eyebrow);
  check("about", "about.title", content.about.title);
  check("about", "about.body", content.about.body);
  check("services", "services.title", content.services.title);
  for (const item of content.services.items) {
    check("services", `services[].${item.id}.title`, item.title);
    check("services", `services[].${item.id}.description`, item.description);
  }
  check("faqs", "faqs.title", content.faqs.title);
  for (const item of content.faqs.items) {
    check("faqs", `faqs[].${item.id}.question`, item.question);
    check("faqs", `faqs[].${item.id}.answer`, item.answer);
  }
  check("contact", "contact.title", content.contact.title);
  check("contact", "contact.phone", content.contact.phone);
  check("contact", "contact.email", content.contact.email);
  check("contact", "contact.address", content.contact.address);
  check("home", "footer.copyright", content.footer.copyright);
  return markers;
}
