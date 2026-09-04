import type { ReactElement } from "react";
import {
  enabledPages,
  isPageKey,
  type PageKey,
  type SiteContent,
} from "@/types/pages";
import { Hero } from "@/components/sections/Hero";
import { About } from "@/components/sections/About";
import { Services } from "@/components/sections/Services";
import { Faq } from "@/components/sections/Faq";
import { Contact } from "@/components/sections/Contact";
import { SiteHeader, SiteFooter } from "@/components/site/SiteShell";

/**
 * Page renderers (Slice 12, Stage C).
 *
 * Each page composes the SAME approved section components and design system
 * as the Home template — no second visual family. Content comes only from
 * the validated `SiteContent` envelope; pages not present in the manifest
 * can never render.
 */

export type PageRenderInput = {
  content: SiteContent;
  pageKey: PageKey;
  brandName: string;
};

function pageFor(pageKey: PageKey): ReturnType<typeof enabledPages>[number] | null {
  return enabledPages({}).find((p) => p.pageKey === pageKey) ?? null;
}

/** Render one enabled page through the shared site shell. Returns null for disabled/unknown pages. */
export function renderProjectPage(input: PageRenderInput): ReactElement | null {
  if (!isPageKey(input.pageKey)) return null;
  const page = pageFor(input.pageKey);
  if (!page) return null;

  const { content } = input;
  const pages = enabledPages({});
  const activeRoute = page.route;
  const shellProps = {
    pages,
    brandName: input.brandName,
    activeRoute,
  };

  let body: ReactElement;
  switch (input.pageKey) {
    case "home":
      body = (
        <>
          <Hero content={content.pages.home.hero} />
          <About content={content.pages.about} />
          <Services services={content.pages.services} />
        </>
      );
      break;
    case "about":
      body = <About content={content.pages.about} />;
      break;
    case "services":
      body = <Services services={content.pages.services} />;
      break;
    case "faqs":
      body = <Faq faqs={content.pages.faqs} />;
      break;
    case "contact":
      body = <Contact content={content.pages.contact} />;
      break;
    default:
      // "shop" requires the WooCommerce capability and is not in the
      // enabled manifest — unreachable here by construction.
      return null;
  }

  return (
    <>
      <SiteHeader
        {...shellProps}
        ctaLabel={content.pages.home.hero.primaryCta.label}
        ctaHref={content.pages.home.hero.primaryCta.href}
      />
      <main>{body}</main>
      <SiteFooter
        pages={pages}
        brandName={input.brandName}
        contactLine={`${content.pages.contact.phone} · ${content.pages.contact.email}`}
        copyright={content.pages.home.footer.copyright}
      />
    </>
  );
}
