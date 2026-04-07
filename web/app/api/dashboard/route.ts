import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MOCK_PAYLOAD = {
  kpis: {
    revenue: 12840.5,
    orders: 156,
    aov: 82.31,
    currency: "EUR",
  },
  dailyRevenue: Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 3, 1 + i));
    return {
      date: d.toISOString().slice(0, 10),
      revenue: Math.round(200 + Math.random() * 400),
    };
  }),
  topProducts: [
    { label: "MOJA Phase+", revenue: 4200, units: 89 },
    { label: "MOJA Phase", revenue: 3800, units: 91 },
    { label: "DUO pack", revenue: 1200, units: 24 },
    { label: "Sample", revenue: 400, units: 40 },
    { label: "Merch", revenue: 180, units: 6 },
  ],
  recentOrders: [1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010].map(
    (id, i) => {
      const day = 20 - Math.floor(i / 2);
      const hh = 9 + (i % 8);
      const mm = (i * 7) % 60;
      return {
        id,
        name: `#${10040 - i}`,
        created_at: `2026-04-${String(day).padStart(2, "0")} ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
        financial_status: i % 4 === 0 ? "PARTIALLY_PAID" : "PAID",
        fulfillment_status: i % 3 === 0 ? "UNFULFILLED" : "FULFILLED",
        customer_display_name:
          i % 5 === 0 ? null : `Zákazník ${String.fromCharCode(65 + (i % 26))}.`,
        total_price: 41.9 + i * 3.5,
        currency: "EUR",
      };
    }
  ),
};

function checkAuth(request: Request): boolean {
  const token = process.env.DASHBOARD_TOKEN;
  if (!token) return true;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${token}`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("mock") === "1") {
    return NextResponse.json(MOCK_PAYLOAD);
  }

  if (!checkAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceKey) {
    const missing = [
      !supabaseUrl && "SUPABASE_URL",
      !serviceKey && "SUPABASE_SERVICE_ROLE_KEY",
    ].filter(Boolean) as string[];
    return NextResponse.json(
      {
        error: `Chýba: ${missing.join(", ")}. Vercel → Project → Settings → Environment Variables: pridaj obe pre Production, potom Redeploy. (Názvy presne takto; service_role secret, nie anon.)`,
      },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data, error } = await supabase.rpc("get_shopify_dashboard_mvp");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
