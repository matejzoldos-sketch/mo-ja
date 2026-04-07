import { Suspense } from "react";
import type { Metadata } from "next";
import SkladClient from "./SkladClient";

export const metadata: Metadata = {
  title: "MO–JA sklad",
  description: "Aktuálny stav zásob zo Shopify",
};

export default function SkladPage() {
  return (
    <Suspense fallback={<p className="msg main-wrap">Načítavam…</p>}>
      <SkladClient />
    </Suspense>
  );
}
