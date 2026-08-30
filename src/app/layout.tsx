import type { Metadata } from "next";
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
      <body>{children}</body>
    </html>
  );
}
