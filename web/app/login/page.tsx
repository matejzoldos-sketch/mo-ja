import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getDashboardSecret } from "@/lib/dashboardAuth";
import LoginClient from "./LoginClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Prihlásenie",
  description: "MO–JA dashboard",
};

export default function LoginPage() {
  if (!getDashboardSecret()) {
    redirect("/");
  }

  return (
    <Suspense fallback={<p className="msg main-wrap">Načítavam…</p>}>
      <LoginClient />
    </Suspense>
  );
}
