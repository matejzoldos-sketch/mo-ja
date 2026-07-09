import { NextResponse } from "next/server";
import { isAuthorizedRequest } from "@/lib/dashboardAuth";
import { jsonNoStoreHeaders } from "@/lib/apiJsonNoStore";
import { supabasePostgrestRpc } from "@/lib/supabasePostgrestRpc";
import {
  periodToRpcPayload,
  resolvePeriodFromSearchParams,
} from "@/lib/dashboardPeriodApi";

export const dynamic = "force-dynamic";

const ALLOWED_KPI_PRODUCT = new Set([
  "all",
  "moja_phase_bez",
  "moja_phase_plus",
  "listky",
]);

export async function GET(request: Request) {
  if (!(await isAuthorizedRequest(request))) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: jsonNoStoreHeaders }
    );
  }

  const url = new URL(request.url);
  const period = resolvePeriodFromSearchParams(url.searchParams, {
    defaultRange: "365d",
  });
  const { p_range: pRange, p_month: pMonth, p_year: pYear } =
    periodToRpcPayload(period);
  const rawKpi =
    url.searchParams.get("kpi_product")?.toLowerCase().trim() ?? "";
  const kpiProductEarly = ALLOWED_KPI_PRODUCT.has(rawKpi) ? rawKpi : "all";
  const pKpiProduct = kpiProductEarly === "all" ? null : kpiProductEarly;

  if (url.searchParams.get("mock") === "1") {
    return NextResponse.json(
      {
        topCustomers: [
          { customer_id: 70111223344, orders: 12, revenue: 890.5, currency: "EUR" },
        ],
        monthlyNewVsReturning: {
          months: ["2026-01-01", "2026-02-01"],
          newRevenue: [420, 380],
          returningRevenue: [2100, 2400],
        },
        purchaseCountDistribution: [
          { bucket: 1, label: "1 nákup", customers: 62, pct: 48.1 },
        ],
        purchaseIntervalHistogram: {
          buckets: [{ bucket: 1, label: "0–7 dní", count: 12 }],
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
      { error: `Chýba: ${missing.join(", ")}.` },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }

  const rpcPayload: Record<string, unknown> = { p_range: pRange };
  if (pMonth) rpcPayload.p_month = pMonth;
  if (pYear) rpcPayload.p_year = pYear;
  if (pKpiProduct != null) rpcPayload.p_kpi_product = pKpiProduct;

  const res = await supabasePostgrestRpc<Record<string, unknown>>(
    supabaseUrl,
    serviceKey,
    "get_shopify_dashboard_mvp",
    rpcPayload
  );

  if (res.error) {
    return NextResponse.json(
      { error: `[dashboard-analytics] ${res.error}` },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }

  const base =
    res.data != null && typeof res.data === "object" && !Array.isArray(res.data)
      ? res.data
      : {};

  return NextResponse.json(
    {
      topCustomers: base.topCustomers ?? [],
      monthlyNewVsReturning: base.monthlyNewVsReturning,
      purchaseCountDistribution: base.purchaseCountDistribution,
      purchaseIntervalHistogram: base.purchaseIntervalHistogram,
    },
    { headers: jsonNoStoreHeaders }
  );
}
