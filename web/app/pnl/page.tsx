import { Suspense } from "react";
import type { Metadata } from "next";
import PnlClient from "./PnlClient";

export const metadata: Metadata = {
  title: "MO–JA P&L (Contribution Margin)",
  description: "Výkaz ziskov a strát (Contribution Margin) z účtovného denníka",
};

export default function PnlPage() {
  return (
    <Suspense fallback={<p className="msg main-wrap">Načítavam…</p>}>
      <PnlClient />
    </Suspense>
  );
}
