import { Suspense } from "react";
import type { Metadata } from "next";
import ScalingClient from "./ScalingClient";

export const metadata: Metadata = {
  title: "MO–JA spend rozhodnutie",
  description: "Executive scaling — či zvyšovať Meta Ads spend",
};

export default function ScalingPage() {
  return (
    <Suspense fallback={<p className="msg main-wrap">Načítavam…</p>}>
      <ScalingClient />
    </Suspense>
  );
}
