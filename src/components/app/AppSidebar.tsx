"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./app-sidebar.module.css";

/**
 * Internal operator sidebar (Slice 6). Client component for pathname
 * highlighting, the collapse toggle, and the mobile drawer. The preference
 * lives in localStorage (no secrets) and is read only inside useEffect so
 * server and first client render agree — no hydration mismatch. Animations
 * respect prefers-reduced-motion via CSS.
 */

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/dashboard" || href === "/projects") return pathname === href;
  // A project workspace link ("/projects/<id>") is active only on its exact
  // route so step links (brief, media, …) own their own highlighting.
  if (/^\/projects\/[^/]+$/.test(href)) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Pure helper: derives the current project id from an operator pathname. */
export function projectIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/projects\/([^/]+)/);
  return match ? match[1] : null;
}

type SidebarLink = {
  href: string;
  label: string;
  icon: string;
  disabled?: boolean;
};

const STORAGE_KEY = "haipa.sidebar.expanded";

const MAIN_LINKS: SidebarLink[] = [
  { href: "/dashboard", label: "Dashboard", icon: "⌂" },
  { href: "/projects", label: "Projects", icon: "▤" },
  { href: "/projects/new", label: "New project", icon: "＋" },
];

const TOOL_LINKS: SidebarLink[] = [
  { href: "/inventory", label: "Site inventory", icon: "☰" },
  { href: "/mapping-review", label: "Mapping review", icon: "⇄" },
  { href: "/editor", label: "Site editor", icon: "✎" },
  { href: "/publication-status", label: "Publication", icon: "◉" },
  { href: "/diagnostics", label: "Diagnostics", icon: "⚙" },
];

export default function AppSidebar() {
  const pathname = usePathname() ?? "/";
  const [expanded, setExpanded] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored !== null) setExpanded(stored === "true");
    } catch {
      // localStorage unavailable — keep the default, toggle still works.
    }
    setHydrated(true);
  }, []);

  function toggleExpanded() {
    setExpanded((prev) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, String(!prev));
      } catch {
        // persistence failure is fine — in-session toggle still works
      }
      return !prev;
    });
  }

  const projectId = projectIdFromPath(pathname);
  const projectLinks: SidebarLink[] = projectId
    ? [
        { href: `/projects/${projectId}`, label: "Workspace", icon: "◧" },
        { href: `/projects/${projectId}/brief`, label: "Brief", icon: "✎" },
        { href: `/projects/${projectId}/media`, label: "Media", icon: "▣" },
        { href: `/projects/${projectId}/template`, label: "Template", icon: "◫" },
        { href: `/projects/${projectId}/generate`, label: "Generate", icon: "⚡" },
        { href: `/projects/${projectId}/preview`, label: "Preview", icon: "◉" },
        { href: `/projects/${projectId}/review`, label: "Review", icon: "✓", disabled: true },
        { href: `/projects/${projectId}/inventory`, label: "Inventory", icon: "≡", disabled: true },
        { href: `/projects/${projectId}/exports`, label: "Exports", icon: "↧", disabled: true },
      ]
    : [];

  const collapsed = hydrated ? !expanded : false;

  function renderLink(link: SidebarLink) {
    const active = isActivePath(pathname, link.href);
    const className = [
      styles.link,
      active ? styles.linkActive : "",
      link.disabled ? styles.linkDisabled : "",
    ]
      .filter(Boolean)
      .join(" ");
    if (link.disabled) {
      return (
        <span
          key={link.href}
          className={className}
          aria-disabled="true"
          aria-label={collapsed ? `${link.label} (coming next)` : undefined}
          title={collapsed ? link.label : undefined}
        >
          <span className={styles.icon} aria-hidden="true">{link.icon}</span>
          {!collapsed && <span>{link.label} <small>(coming next)</small></span>}
        </span>
      );
    }
    return (
      <Link
        key={link.href}
        href={link.href}
        className={className}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? link.label : undefined}
        title={collapsed ? link.label : undefined}
        onClick={() => setDrawerOpen(false)}
      >
        <span className={styles.icon} aria-hidden="true">{link.icon}</span>
        {!collapsed && <span>{link.label}</span>}
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        className={styles.mobileToggle}
        aria-label={drawerOpen ? "Close navigation drawer" : "Open navigation drawer"}
        aria-expanded={drawerOpen}
        onClick={() => setDrawerOpen((prev) => !prev)}
      >
        ☰ Menu
      </button>
      {drawerOpen && (
        <button
          type="button"
          className={styles.scrim}
          aria-label="Close navigation drawer"
          onClick={() => setDrawerOpen(false)}
        />
      )}
      <nav
      className={[
        styles.sidebar,
        collapsed ? styles.collapsed : "",
        drawerOpen ? styles.drawerOpen : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label="Operator navigation"
    >
      <div className={styles.brand}>
        <Link
          href="/dashboard"
          className={styles.brandLink}
          onClick={() => setDrawerOpen(false)}
        >
          <strong>Haipa&nbsp;Labs</strong>
          {!collapsed && <span> · Omoka</span>}
        </Link>
      </div>

      <button
        type="button"
        className={styles.toggle}
        onClick={toggleExpanded}
        aria-pressed={expanded}
        aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
      >
        {expanded ? "« Collapse" : "»"}
      </button>

      <div className={styles.section}>{MAIN_LINKS.map(renderLink)}</div>

      {projectId && (
        <div className={styles.section}>
          {!collapsed && <p className={styles.sectionTitle}>Project workspace</p>}
          {projectLinks.map(renderLink)}
        </div>
      )}

      <div className={styles.section}>
        {!collapsed && <p className={styles.sectionTitle}>Site tools</p>}
        {TOOL_LINKS.map(renderLink)}
      </div>

      <button
        type="button"
        className={styles.mobileClose}
        aria-label="Close navigation drawer"
        onClick={() => setDrawerOpen(false)}
      >
        ✕ Close
      </button>
    </nav>
    </>
  );
}
