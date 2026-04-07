import { Suspense } from "react";
import DashboardClient from "./DashboardClient";

export default function Home() {
  return (
    <Suspense fallback={<p className="msg main-wrap">Načítavam…</p>}>
      <DashboardClient />
    </Suspense>
  );
}
