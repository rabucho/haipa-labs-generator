import type { ReactElement } from "react";
import { HomeContentSchema, type HomeContent } from "@/types/content";
import type { ContentInventory } from "@/types/inventory";
import { HomeTemplate } from "@/components/HomeTemplate";
import { contentInventory } from "@/content/content-inventory";
import { homeFixture } from "@/content/home.fixture";

/**
 * Template registry (Slice A).
 *
 * A template bundles an approved React renderer, its supported content
 * schema, its explicit editable-content inventory, default demo content,
 * and design-token metadata. The renderer receives TYPED content and never
 * reads raw WordPress JSON, project files, or AI responses directly.
 *
 * Slice A ships ONE fully working template (the approved HomeTemplate) plus
 * two clearly-marked planned registrations. Planned templates are never
 * selectable for project creation or generation.
 */

export type TemplateTheme = {
  /** Theme name/version for the template's design-token set. */
  name: string;
  /** Documented token defaults (the approved design applies them in CSS). */
  tokens: Record<string, string>;
};

export type TemplateRenderer = (props: {
  content: HomeContent;
}) => ReactElement;

export type TemplateDefinition = {
  id: string;
  name: string;
  category: string;
  description: string;
  mood: string;
  version: string;
  status: "ready" | "planned";
  /** Planned templates omit renderer/content until they are built. */
  schema?: typeof HomeContentSchema;
  defaultContent?: HomeContent;
  requiredFields?: string[];
  inventory?: () => ContentInventory[];
  render?: TemplateRenderer;
  theme?: TemplateTheme;
};

const professionalServicesTemplate: TemplateDefinition = {
  id: "premium-professional-services-home",
  name: "Premium Professional Services — Home",
  category: "professional-services",
  description:
    "A premium single-page home for professional services firms: hero, about, services grid, FAQs, and contact — engineered for trust and conversion.",
  mood: "Calm, premium, trustworthy — deep slate, deep sage, warm cream accents.",
  version: "1.0.0",
  status: "ready",
  schema: HomeContentSchema,
  defaultContent: homeFixture,
  requiredFields: contentInventory
    .filter((f) => f.editable && f.required)
    .map((f) => f.path),
  inventory: () => contentInventory,
  render: ({ content }) => <HomeTemplate content={content} />,
  theme: {
    name: "haipa-premium-v1",
    tokens: {
      "--color-primary": "#0f766e",
      "--color-secondary": "#0f172a",
      "--color-accent": "#f59e0b",
      "--color-bg-light": "#f8fafc",
      "--color-bg-card": "#ffffff",
      "sectionPaddingDesktop": "6rem 0",
      "sectionPaddingMobile": "4rem 0",
      "containerMaxWidth": "1200px",
    },
  },
};

// Planned registrations: clearly marked, never selectable for generation.
const hospitalityTemplate: TemplateDefinition = {
  id: "premium-hospitality-lodging-home",
  name: "Premium Hospitality & Lodging — Home",
  category: "hospitality",
  description:
    "Planned: an immersive home for lodges, hotels, and travel experiences with imagery-led storytelling.",
  mood: "Warm, cinematic, inviting.",
  version: "0.1.0",
  status: "planned",
};

const realEstateTemplate: TemplateDefinition = {
  id: "premium-real-estate-home",
  name: "Premium Real Estate — Home",
  category: "real-estate",
  description:
    "Planned: a property-focused home for agencies and developers with listing highlights and area storytelling.",
  mood: "Bold, spatial, aspirational.",
  version: "0.1.0",
  status: "planned",
};

const templates: TemplateDefinition[] = [
  professionalServicesTemplate,
  hospitalityTemplate,
  realEstateTemplate,
];

export function listTemplates(): TemplateDefinition[] {
  return templates;
}

export function listReadyTemplates(): TemplateDefinition[] {
  return templates.filter((t) => t.status === "ready");
}

export function getTemplate(id: string): TemplateDefinition | null {
  return templates.find((t) => t.id === id) ?? null;
}

export function getReadyTemplate(id: string): TemplateDefinition | null {
  const template = getTemplate(id);
  return template && template.status === "ready" ? template : null;
}

/** Type guard for template selection in generation/rendering flows. */
export function isReadyTemplate(
  template: TemplateDefinition
): template is TemplateDefinition & {
  schema: typeof HomeContentSchema;
  defaultContent: HomeContent;
  requiredFields: string[];
  inventory: () => ContentInventory[];
  render: TemplateRenderer;
} {
  return template.status === "ready";
}
