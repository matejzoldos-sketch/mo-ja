import type { Metadata } from "next";
import "./globals.css";
import IdleSessionGuard from "./components/IdleSessionGuard";

export const metadata: Metadata = {
  title: {
    default: "MO–JA predaj",
    template: "%s",
  },
  description: "MO–JA interné prehľady",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sk">
      <body>
        <IdleSessionGuard />
        {children}
      </body>
    </html>
  );
}
