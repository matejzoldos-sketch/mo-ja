import { Suspense } from "react";
import type { Metadata } from "next";
import MarketingClient from "./MarketingClient";

export const metadata: Metadata = {
  title: "MO–JA marketing",
  description: "MER — revenue, ads, fees a marketing efficiency",
};

export default function MarketingPage() {
  return (
    <Suspense fallback={<p className="msg main-wrap">Načítavam…</p>}>
      <MarketingClient />
    </Suspense>
  );
}
