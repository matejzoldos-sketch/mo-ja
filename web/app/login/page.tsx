import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import {
  getDashboardSecret,
  isOpenDashboardAllowed,
} from "@/lib/dashboardAuth";
import LoginClient from "./LoginClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Prihlásenie",
  description: "MO–JA dashboard",
};

export default function LoginPage() {
  if (!getDashboardSecret()) {
    if (isOpenDashboardAllowed()) {
      redirect("/");
    }
    return (
      <main className="main-wrap login-page">
        <div className="login-card">
          <h1 className="login-card__title">MO–JA dashboard</h1>
          <p className="login-card__hint">
            Dashboard nie je nakonfigurovaný. Nastav DASHBOARD_PASSWORD.
          </p>
        </div>
      </main>
    );
  }

  return (
    <Suspense fallback={<p className="msg main-wrap">Načítavam…</p>}>
      <LoginClient />
    </Suspense>
  );
}
