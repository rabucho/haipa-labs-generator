import { redirect } from "next/navigation";

/**
 * / — the operator landing point. Redirects to the Haipa Labs operator hub.
 */
export default function RootPage() {
  redirect("/dashboard");
}