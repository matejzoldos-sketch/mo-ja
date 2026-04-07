import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MOJA PHASE — predaj",
  description: "Prehľad objednávok zo Shopify",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sk">
      <body>{children}</body>
    </html>
  );
}
