import { NextResponse } from "next/server";
import { isAuthorizedRequest } from "@/lib/dashboardAuth";
import { jsonNoStoreHeaders } from "@/lib/apiJsonNoStore";
import { resolveLastSyncAt } from "@/lib/resolveLastSyncAt";
import { supabasePostgrestRpc } from "@/lib/supabasePostgrestRpc";

export const dynamic = "force-dynamic";

const ALLOWED_RANGE = new Set(["ytd", "30d", "90d", "365d"]);
const ALLOWED_KPI_PRODUCT = new Set(["all", "moja_phase_bez", "moja_phase_plus"]);

/** Prvý segment hostu *.supabase.co — na overenie, že Production volá očakávaný projekt. */
function supabaseProjectRef(url: string): string | null {
  try {
    const h = new URL(url.trim()).hostname.toLowerCase();
    const m = /^([a-z0-9]+)\.supabase\.co$/i.exec(h);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

function dashboardHeaders(
  supabaseUrl: string,
  metaTo?: string | null
): Record<string, string> {
  const ref = supabaseProjectRef(supabaseUrl);
  return {
    ...jsonNoStoreHeaders,
    ...(ref ? { "x-supabase-project-ref": ref } : {}),
    ...(metaTo ? { "x-dashboard-meta-to": metaTo } : {}),
  };
}

const MOCK_PAYLOAD = {
  meta: {
    range: "365d",
    from: "2025-04-04",
    to: "2026-04-04",
    kpi_product: "all",
  },
  kpis: {
    revenue: 12840.5,
    orders: 156,
    aov: 82.31,
    currency: "EUR",
    avg_units_per_order: 2.15,
    returning_customers_pct: 42.5,
    avg_customer_ltv: 312.45,
    avg_units_per_unique_customer: 4.62,
    avg_days_first_to_second_purchase: 38.5,
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
  monthlyNewVsReturning: {
    months: ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"],
    newRevenue: [420, 380, 510, 290],
    returningRevenue: [2100, 2400, 2280, 1950],
  },
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
  const normalized =
    rawRangeEarly === "ytd" ? "365d" : rawRangeEarly;
  const rangeEarly = ALLOWED_RANGE.has(normalized) ? normalized : "30d";
  const rawKpi =
    url.searchParams.get("kpi_product")?.toLowerCase().trim() ?? "";
  const kpiProductEarly = ALLOWED_KPI_PRODUCT.has(rawKpi) ? rawKpi : "all";
  const pKpiProduct =
    kpiProductEarly === "all" ? null : kpiProductEarly;

  if (url.searchParams.get("mock") === "1") {
    return NextResponse.json(
      {
        ...MOCK_PAYLOAD,
        meta: {
          ...MOCK_PAYLOAD.meta,
          range: rangeEarly,
          kpi_product: kpiProductEarly,
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

  const dashRpcPayload: Record<string, unknown> = { p_range: rangeEarly };
  if (pKpiProduct != null) dashRpcPayload.p_kpi_product = pKpiProduct;

  const [dashRes, lastSyncAt] = await Promise.all([
    supabasePostgrestRpc<Record<string, unknown>>(
      supabaseUrl,
      serviceKey,
      "get_shopify_dashboard_mvp",
      dashRpcPayload
    ),
    resolveLastSyncAt(supabaseUrl, serviceKey),
  ]);

  if (dashRes.error) {
    return NextResponse.json(
      { error: dashRes.error },
      { status: 500, headers: dashboardHeaders(supabaseUrl, null) }
    );
  }

  const rawDash = dashRes.data;
  const base =
    rawDash != null && typeof rawDash === "object" && !Array.isArray(rawDash)
      ? rawDash
      : {};

  const meta = base.meta;
  const metaTo =
    meta != null &&
    typeof meta === "object" &&
    !Array.isArray(meta) &&
    "to" in meta
      ? String((meta as { to: unknown }).to)
      : null;

  return NextResponse.json(
    {
      ...base,
      lastSyncAt,
    },
    { headers: dashboardHeaders(supabaseUrl, metaTo) }
  );
}
