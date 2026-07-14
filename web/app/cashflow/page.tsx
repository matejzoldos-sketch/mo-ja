import { Suspense } from "react";
import type { Metadata } from "next";
import CashflowClient from "./CashflowClient";

export const metadata: Metadata = {
  title: "MO–JA cash flow",
  description: "Mesačný prehľad príjmov a výdavkov z Tatra banky",
};

export default function CashflowPage() {
  return (
    <Suspense fallback={<p className="msg main-wrap">Načítavam…</p>}>
      <CashflowClient />
    </Suspense>
  );
}
