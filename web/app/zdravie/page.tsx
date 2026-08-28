import { Suspense } from "react";
import type { Metadata } from "next";
import ZdravieClient from "./ZdravieClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "MO–JA finančné zdravie",
  description:
    "Executive prehľad likvidity a P&L (hybridný model: XLS + COGS 42 % z tovaru)",
};

export default function ZdraviePage() {
  return (
    <Suspense fallback={<p className="msg main-wrap">Načítavam…</p>}>
      <ZdravieClient />
    </Suspense>
  );
}
