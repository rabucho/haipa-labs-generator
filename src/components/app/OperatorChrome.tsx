"use client";

import { usePathname } from "next/navigation";
import AppSidebar from "./AppSidebar";
import styles from "./operator-chrome.module.css";

/**
 * Operator chrome (Slice 6): wraps every page in the operator shell with the
 * sidebar, EXCEPT the public generated-site preview routes, which must look
 * like the prospect's site. Client component (needs usePathname); children
 * remain server-rendered — the chrome itself adds no hydration risk because
 * usePathname is stable between server and client.
 */

const PREVIEW_PREFIXES = ["/preview"];
const PREVIEW_PATTERN = /^\/projects\/[^/]+\/preview/;

export default function OperatorChrome({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const isPreview =
    PREVIEW_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}?`) || pathname.startsWith(`${p}/`)) ||
    PREVIEW_PATTERN.test(pathname);

  if (isPreview) {
    // Public-looking generated site: no internal chrome at all.
    return <>{children}</>;
  }

  return (
    <div className={styles.shell}>
      <AppSidebar />
      <div className={styles.content}>{children}</div>
    </div>
  );
}
