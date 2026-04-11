import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { isAuthorizedRequest } from "@/lib/dashboardAuth";
import { jsonNoStoreHeaders } from "@/lib/apiJsonNoStore";
import { resolveLastSyncAt } from "@/lib/resolveLastSyncAt";

export const dynamic = "force-dynamic";

const ALLOWED_RANGE = new Set(["ytd", "30d", "90d"]);

const MOCK_PAYLOAD = {
  meta: {
    range: "ytd",
    from: "2026-01-01",
    to: "2026-04-04",
  },
  kpis: {
    revenue: 12840.5,
    orders: 156,
    aov: 82.31,
    currency: "EUR",
    returning_customers_pct: 42.5,
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
  topCustomers: [
    { customer_id: 70111223344, orders: 12, revenue: 890.5, currency: "EUR" },
    { customer_id: 70999887766, orders: 8, revenue: 612.0, currency: "EUR" },
    { customer_id: 70555444333, orders: 5, revenue: 340.25, currency: "EUR" },
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
  lastSyncAt: "2026-04-07T17:23:00.000Z",
  skuDailyYtd: {
    year: 2026,
    from: "2026-01-01",
    to: "2026-04-04",
    skuOrder: ["MOJA Phase", "MOJA Phase+", "DUO pack"],
    points: [
      { date: "2026-01-02", sku: "MOJA Phase", units: 3 },
      { date: "2026-01-02", sku: "MOJA Phase+", units: 1 },
      { date: "2026-01-05", sku: "MOJA Phase", units: 2 },
      { date: "2026-01-05", sku: "DUO pack", units: 4 },
      { date: "2026-01-08", sku: "MOJA Phase+", units: 5 },
      { date: "2026-01-10", sku: "MOJA Phase", units: 1 },
      { date: "2026-01-12", sku: "DUO pack", units: 2 },
      { date: "2026-01-15", sku: "MOJA Phase", units: 4 },
      { date: "2026-01-18", sku: "MOJA Phase+", units: 2 },
    ],
  },
};

export async function GET(request: Request) {
  if (!(await isAuthorizedRequest(request))) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: jsonNoStoreHeaders }
    );
  }

  const url = new URL(request.url);
  const rawRangeEarly = url.searchParams.get("range")?.toLowerCase().trim() ?? "";
  const rangeEarly = ALLOWED_RANGE.has(rawRangeEarly) ? rawRangeEarly : "ytd";
  if (url.searchParams.get("mock") === "1") {
    return NextResponse.json(
      {
        ...MOCK_PAYLOAD,
        meta: {
          ...MOCK_PAYLOAD.meta,
          range: rangeEarly,
        },
      },
      { headers: jsonNoStoreHeaders }
    );
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
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const [dashRes, skuRes, lastSyncAt] = await Promise.all([
    supabase.rpc("get_shopify_dashboard_mvp", { p_range: rangeEarly }),
    supabase.rpc("get_shopify_sku_units_daily_ytd"),
    resolveLastSyncAt(supabase),
  ]);

  if (dashRes.error) {
    return NextResponse.json(
      { error: dashRes.error.message },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }
  if (skuRes.error) {
    return NextResponse.json(
      { error: skuRes.error.message },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }

  const base =
    dashRes.data !== null &&
    typeof dashRes.data === "object" &&
    !Array.isArray(dashRes.data)
      ? (dashRes.data as Record<string, unknown>)
      : {};

  return NextResponse.json(
    {
      ...base,
      skuDailyYtd: skuRes.data,
      lastSyncAt,
    },
    { headers: jsonNoStoreHeaders }
  );
}
