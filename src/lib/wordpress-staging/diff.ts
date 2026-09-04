import type { HomeContent } from "@/types/content";

/**
 * Draft-versus-staging content diff (Slice 11).
 *
 * PURE and DETERMINISTIC: no network, no clock, no randomness. Compares two
 * already-normalized `HomeContent` values (an approved local draft and staging
 * content read back through `mapWordPressHome` + `HomeContentSchema`).
 *
 * - Repeater items (services, FAQs) are compared by their STABLE ids, never by
 *   array index or raw object equality.
 * - Only editable business content is diffed; design-controlled values do not
 *   exist in `HomeContent` and are structurally excluded.
 * - Text is truncated for safe display; truncation is display-only.
 */

const MAX_DISPLAY_CHARS = 80;

export type DiffValueChange = {
  path: string;
  label: string;
  draft: string;
  staging: string;
};

export type DiffRowChange = {
  id: string;
  field: string;
  draft: string | null;
  staging: string | null;
};

export type ContentDiff = {
  unchanged: boolean;
  text: DiffValueChange[];
  links: DiffValueChange[];
  services: {
    added: string[];
    removed: string[];
    changed: DiffRowChange[];
  };
  faqs: {
    added: string[];
    removed: string[];
    changed: DiffRowChange[];
  };
  images: DiffValueChange[];
};

function clip(value: string): string {
  return value.length <= MAX_DISPLAY_CHARS
    ? value
    : `${value.slice(0, MAX_DISPLAY_CHARS)}…`;
}

function textChange(
  path: string,
  label: string,
  draft: string,
  staging: string
): DiffValueChange {
  return { path, label, draft: clip(draft), staging: clip(staging) };
}

function compareServices(
  draftItems: HomeContent["services"]["items"],
  stagingItems: HomeContent["services"]["items"]
): ContentDiff["services"] {
  const draftById = new Map(draftItems.map((i) => [i.id, i]));
  const stagingById = new Map(stagingItems.map((i) => [i.id, i]));
  const added = stagingItems
    .map((i) => i.id)
    .filter((id) => !draftById.has(id));
  const removed = draftItems
    .map((i) => i.id)
    .filter((id) => !stagingById.has(id));
  const changed: DiffRowChange[] = [];
  for (const [id, draftItem] of draftById) {
    const stagingItem = stagingById.get(id);
    if (!stagingItem) continue;
    if (draftItem.title !== stagingItem.title) {
      changed.push({
        id,
        field: "title",
        draft: clip(draftItem.title),
        staging: clip(stagingItem.title),
      });
    }
    if (draftItem.description !== stagingItem.description) {
      changed.push({
        id,
        field: "description",
        draft: clip(draftItem.description),
        staging: clip(stagingItem.description),
      });
    }
    if ((draftItem.href ?? null) !== (stagingItem.href ?? null)) {
      changed.push({
        id,
        field: "href",
        draft: draftItem.href ? clip(draftItem.href) : null,
        staging: stagingItem.href ? clip(stagingItem.href) : null,
      });
    }
  }
  return { added, removed, changed };
}

function compareFaqs(
  draftItems: HomeContent["faqs"]["items"],
  stagingItems: HomeContent["faqs"]["items"]
): ContentDiff["faqs"] {
  const draftById = new Map(draftItems.map((i) => [i.id, i]));
  const stagingById = new Map(stagingItems.map((i) => [i.id, i]));
  const added = stagingItems
    .map((i) => i.id)
    .filter((id) => !draftById.has(id));
  const removed = draftItems
    .map((i) => i.id)
    .filter((id) => !stagingById.has(id));
  const changed: DiffRowChange[] = [];
  for (const [id, draftItem] of draftById) {
    const stagingItem = stagingById.get(id);
    if (!stagingItem) continue;
    if (draftItem.question !== stagingItem.question) {
      changed.push({
        id,
        field: "question",
        draft: clip(draftItem.question),
        staging: clip(stagingItem.question),
      });
    }
    if (draftItem.answer !== stagingItem.answer) {
      changed.push({
        id,
        field: "answer",
        draft: clip(draftItem.answer),
        staging: clip(stagingItem.answer),
      });
    }
  }
  return { added, removed, changed };
}

/**
 * Compare the approved draft against normalized staging content.
 * Both inputs must already be valid `HomeContent` (the diff never validates
 * or fetches — that is the caller's job).
 */
export function diffHomeContent(
  draft: HomeContent,
  staging: HomeContent
): ContentDiff {
  const text: DiffValueChange[] = [];
  const links: DiffValueChange[] = [];
  const images: DiffValueChange[] = [];

  if (draft.hero.title !== staging.hero.title) {
    text.push(textChange("hero.title", "Hero title", draft.hero.title, staging.hero.title));
  }
  if (draft.hero.body !== staging.hero.body) {
    text.push(textChange("hero.body", "Hero body", draft.hero.body, staging.hero.body));
  }
  if (draft.hero.eyebrow !== staging.hero.eyebrow) {
    text.push(textChange("hero.eyebrow", "Hero eyebrow", draft.hero.eyebrow, staging.hero.eyebrow));
  }
  if (draft.hero.primaryCta.label !== staging.hero.primaryCta.label) {
    links.push(
      textChange(
        "hero.primaryCta.label",
        "Hero button label",
        draft.hero.primaryCta.label,
        staging.hero.primaryCta.label
      )
    );
  }
  if (draft.hero.primaryCta.href !== staging.hero.primaryCta.href) {
    links.push(
      textChange(
        "hero.primaryCta.href",
        "Hero button link",
        draft.hero.primaryCta.href,
        staging.hero.primaryCta.href
      )
    );
  }
  const draftImage = draft.hero.image?.url ?? null;
  const stagingImage = staging.hero.image?.url ?? null;
  if (draftImage !== stagingImage) {
    images.push({
      path: "hero.image",
      label: "Hero image",
      draft: draftImage ? clip(draftImage) : "(none)",
      staging: stagingImage ? clip(stagingImage) : "(none)",
    });
  }

  if (draft.about.title !== staging.about.title) {
    text.push(textChange("about.title", "About title", draft.about.title, staging.about.title));
  }
  if (draft.about.body !== staging.about.body) {
    text.push(textChange("about.body", "About body", draft.about.body, staging.about.body));
  }
  if (draft.services.title !== staging.services.title) {
    text.push(
      textChange("services.title", "Services heading", draft.services.title, staging.services.title)
    );
  }
  if (draft.faqs.title !== staging.faqs.title) {
    text.push(
      textChange("faqs.title", "FAQs heading", draft.faqs.title, staging.faqs.title)
    );
  }
  if (draft.contact.title !== staging.contact.title) {
    text.push(textChange("contact.title", "Contact heading", draft.contact.title, staging.contact.title));
  }
  if (draft.contact.phone !== staging.contact.phone) {
    text.push(textChange("contact.phone", "Contact phone", draft.contact.phone, staging.contact.phone));
  }
  if (draft.contact.email !== staging.contact.email) {
    text.push(textChange("contact.email", "Contact email", draft.contact.email, staging.contact.email));
  }
  if (draft.contact.address !== staging.contact.address) {
    text.push(textChange("contact.address", "Contact address", draft.contact.address, staging.contact.address));
  }
  if (draft.footer.copyright !== staging.footer.copyright) {
    text.push(
      textChange("footer.copyright", "Footer copyright", draft.footer.copyright, staging.footer.copyright)
    );
  }

  const services = compareServices(draft.services.items, staging.services.items);
  const faqs = compareFaqs(draft.faqs.items, staging.faqs.items);

  const unchanged =
    text.length === 0 &&
    links.length === 0 &&
    images.length === 0 &&
    services.added.length === 0 &&
    services.removed.length === 0 &&
    services.changed.length === 0 &&
    faqs.added.length === 0 &&
    faqs.removed.length === 0 &&
    faqs.changed.length === 0;

  return { unchanged, text, links, services, faqs, images };
}
