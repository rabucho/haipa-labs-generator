import type { Metadata } from "next";
import OperatorChrome from "@/components/app/OperatorChrome";
import "./globals.css";

export const metadata: Metadata = {
  title: "Amani Tech Consulting",
  description: "Engineering bespoke software solutions for African businesses",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <OperatorChrome>{children}</OperatorChrome>
      </body>
    </html>
  );
}
