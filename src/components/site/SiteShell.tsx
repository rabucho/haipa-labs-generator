import Link from "next/link";
import type { PageDefinition } from "@/types/pages";

/**
 * SiteShell — the design-controlled header/footer shell of the generated
 * prospect website (Slice 12). Navigation is generated from the enabled page
 * manifest, never hard-coded per page. WordPress may supply labels/links via
 * structured content but can never inject arbitrary layout or HTML.
 *
 * This is the public-facing website shell: it is rendered WITHOUT the
 * Haipa Labs operator chrome.
 */

const brandMark = "HL";

export function SiteHeader({
  pages,
  brandName,
  activeRoute,
  ctaLabel,
  ctaHref,
}: {
  pages: PageDefinition[];
  brandName: string;
  activeRoute: string;
  ctaLabel?: string;
  ctaHref?: string;
}) {
  return (
    <header className="site-header">
      <div className="container site-header-inner">
        <Link href="/" className="site-brand" aria-label={`${brandName} — home`}>
          <span className="site-brand-mark" aria-hidden="true">
            {brandMark}
          </span>
          <span className="site-brand-name">{brandName}</span>
        </Link>

        <nav aria-label="Primary" className="site-nav">
          <ul className="site-nav-list">
            {pages.map((page) => (
              <li key={page.pageKey}>
                <Link
                  href={page.route}
                  className={
                    page.route === activeRoute
                      ? "site-nav-link site-nav-link--active"
                      : "site-nav-link"
                  }
                  aria-current={page.route === activeRoute ? "page" : undefined}
                >
                  {page.displayName}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {ctaLabel && ctaHref && (
          <Link href={ctaHref} className="site-header-cta">
            {ctaLabel}
          </Link>
        )}

        {/* Mobile drawer: pure CSS/HTML, keyboard accessible. */}
        <details className="site-mobile-menu">
          <summary aria-label="Open navigation menu">Menu</summary>
          <nav aria-label="Mobile" className="site-mobile-nav">
            <ul>
              {pages.map((page) => (
                <li key={page.pageKey}>
                  <Link
                    href={page.route}
                    className={
                      page.route === activeRoute
                        ? "site-nav-link site-nav-link--active"
                        : "site-nav-link"
                    }
                    aria-current={page.route === activeRoute ? "page" : undefined}
                  >
                    {page.displayName}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </details>
      </div>
    </header>
  );
}

export function SiteFooter({
  pages,
  brandName,
  contactLine,
  copyright,
}: {
  pages: PageDefinition[];
  brandName: string;
  contactLine?: string;
  copyright: string;
}) {
  return (
    <footer className="site-footer">
      <div className="container site-footer-inner">
        <div>
          <p className="site-brand-name">{brandName}</p>
          {contactLine && <p className="site-footer-contact">{contactLine}</p>}
        </div>
        <nav aria-label="Footer" className="site-footer-nav">
          <ul>
            {pages.map((page) => (
              <li key={page.pageKey}>
                <Link href={page.route} className="site-nav-link">
                  {page.displayName}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="site-footer-copyright">{copyright}</p>
      </div>
    </footer>
  );
}
