import { notFound } from "next/navigation";
import { templateVersionStore } from "@/lib/templates/version-store";
import { siteContentFromHomeContent } from "@/types/pages";
import { homeFixture } from "@/content/home.fixture";
import { Hero } from "@/components/sections/Hero";
import { About } from "@/components/sections/About";
import { Services } from "@/components/sections/Services";
import { Faq } from "@/components/sections/Faq";
import { Contact } from "@/components/sections/Contact";
import { SiteHeader, SiteFooter } from "@/components/site/SiteShell";
import { APPROVED_TOKEN_KEYS, type BuilderDocument } from "@/types/builder";
import type { PageDefinition } from "@/types/pages";

export const dynamic = "force-dynamic";

/**
 * /templates/[versionId]/preview — renders the version through the REAL
 * registered section components and SiteShell (no approximation), with the
 * version's approved design tokens applied as CSS-variable overrides.
 * Schema already restricts token keys/values (hex colours, approved enums).
 */
export default async function TemplateVersionPreview({
  params,
}: {
  params: Promise<{ versionId: string }>;
}) {
  const { versionId } = await params;
  const version = await templateVersionStore.get(versionId);
  if (!version) notFound();

  const doc: BuilderDocument = version.document;
  const site = siteContentFromHomeContent(
    homeFixture,
    "premium-professional-services-home",
    version.version
  );
  const pages: PageDefinition[] = doc.pages
    .filter((p) => p.enabled)
    .map((p) => ({
      pageKey: p.pageKey,
      route: p.pageKey === "home" ? "/" : `/${p.pageKey}`,
      displayName: p.pageKey.charAt(0).toUpperCase() + p.pageKey.slice(1),
      enabledByDefault: true,
      required: p.pageKey === "home",
      requiresCapability: "none",
    }));

  const tokenCss = APPROVED_TOKEN_KEYS.map((key) => {
    const value = doc.designTokens[key];
    return value ? `${key}: ${value};` : "";
  })
    .filter(Boolean)
    .join(" ");

  const homeSections = (
    doc.pages.find((p) => p.pageKey === "home")?.sections ?? []
  )
    .sort((a, b) => a.order - b.order)
    .map((s) => s.sectionType);

  const sectionFor = (type: string) => {
    switch (type) {
      case "hero":
        return <Hero key={type} content={site.pages.home.hero} />;
      case "about":
        return <About key={type} content={site.pages.about} />;
      case "services":
        return <Services key={type} services={site.pages.services} />;
      case "faqs":
        return <Faq key={type} faqs={site.pages.faqs} />;
      case "contact":
        return <Contact key={type} content={site.pages.contact} />;
      default:
        return null;
    }
  };

  return (
    <>
      {tokenCss && <style>{`:root { ${tokenCss} }`}</style>}
      <SiteHeader
        pages={pages}
        brandName="Builder Preview"
        activeRoute="/"
        ctaLabel={site.pages.home.hero.primaryCta.label}
        ctaHref={site.pages.home.hero.primaryCta.href}
      />
      <main>{homeSections.map((type) => sectionFor(type))}</main>
      <SiteFooter
        pages={pages}
        brandName="Builder Preview"
        contactLine={`${site.pages.contact.phone} · ${site.pages.contact.email}`}
        copyright={site.pages.home.footer.copyright}
      />
    </>
  );
}
