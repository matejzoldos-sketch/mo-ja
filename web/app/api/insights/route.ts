import { NextResponse } from "next/server";
import { isAuthorizedRequest } from "@/lib/dashboardAuth";
import { jsonNoStoreHeaders } from "@/lib/apiJsonNoStore";
import { formatRpcError } from "@/lib/formatRpcError";
import { supabasePostgrestRpc } from "@/lib/supabasePostgrestRpc";
import { evaluateInsights } from "@/lib/insights/evaluate";
import type {
  DashboardKpis,
  DashboardPayload,
  InsightsResponse,
  InventoryRow,
  SkuDaily,
  MarketingPayload,
} from "@/lib/insights/types";

export const dynamic = "force-dynamic";

const ALLOWED_RANGE = new Set(["30d", "90d", "365d", "ytd"]);
const ALLOWED_KPI_PRODUCT = new Set([
  "all",
  "moja_phase_bez",
  "moja_phase_plus",
  "listky",
]);

function resolveRange(searchParams: URLSearchParams): string {
  const raw = searchParams.get("range")?.toLowerCase().trim() ?? "";
  if (!raw) return "90d";
  if (ALLOWED_RANGE.has(raw)) return raw === "ytd" ? "365d" : raw;
  return "90d";
}

function resolveKpiProduct(searchParams: URLSearchParams): string {
  const raw = searchParams.get("kpi_product")?.toLowerCase().trim() ?? "";
  if (!raw) return "all";
  if (ALLOWED_KPI_PRODUCT.has(raw)) return raw;
  return "all";
}

function mergeKpis(base: DashboardKpis, extra: Record<string, unknown>): DashboardKpis {
  const pickNum = (key: keyof DashboardKpis) => {
    const v = extra[key];
    if (v == null) return base[key];
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : base[key];
  };
  return {
    ...base,
    returning_customers_pct: pickNum("returning_customers_pct") as number | null | undefined,
    avg_days_first_to_second_purchase: pickNum(
      "avg_days_first_to_second_purchase"
    ) as number | null | undefined,
    avg_customer_ltv: pickNum("avg_customer_ltv") as number | null | undefined,
    avg_units_per_unique_customer: pickNum(
      "avg_units_per_unique_customer"
    ) as number | null | undefined,
    avg_units_per_order: pickNum("avg_units_per_order") as number | null | undefined,
  };
}

export async function GET(request: Request) {
  if (!(await isAuthorizedRequest(request))) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: jsonNoStoreHeaders }
    );
  }

  const url = new URL(request.url);
  const range = resolveRange(url.searchParams);
  const kpiProduct = resolveKpiProduct(url.searchParams);
  const pKpi = kpiProduct === "all" ? null : kpiProduct;

  if (url.searchParams.get("mock") === "1") {
    const now = new Date();
    const out: InsightsResponse = {
      meta: { range, from: "2026-01-01", to: "2026-04-04", kpi_product: kpiProduct },
      generatedAt: now.toISOString(),
      risks: [
        {
          id: "mock_risk",
          kind: "risk",
          severity: "warning",
          score: 80,
          title: "Mock riziko",
          body: "Ukážkový insight pre vývoj (mock=1).",
          metric: { label: "Δ", value: "-12,0 %" },
          link: { href: "/?range=90d", label: "Otvoriť predaj" },
        },
      ],
      opportunities: [
        {
          id: "mock_opp",
          kind: "opportunity",
          severity: "info",
          score: 50,
          title: "Mock príležitosť",
          body: "Ukážkový insight pre vývoj (mock=1).",
          metric: { label: "AOV", value: "65,48 €", delta: "+8,0 %" },
          link: { href: "/?range=90d", label: "Otvoriť predaj" },
        },
      ],
    };
    return NextResponse.json(out, { headers: jsonNoStoreHeaders });
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

  const summaryPayload: Record<string, unknown> = { p_range: range };
  if (pKpi != null) summaryPayload.p_kpi_product = pKpi;
  const skuRpcPayload: Record<string, unknown> = { p_range: range };
  if (pKpi != null) skuRpcPayload.p_kpi_product = pKpi;
  const marketingRpcPayload: Record<string, unknown> = { p_range: range };

  const [dashRes, skuRes, invRes, marketingRes] = await Promise.all([
    supabasePostgrestRpc<unknown>(
      supabaseUrl,
      serviceKey,
      "get_shopify_dashboard_summary",
      summaryPayload
    ),
    supabasePostgrestRpc<unknown>(
      supabaseUrl,
      serviceKey,
      "get_shopify_sku_units_daily_ytd",
      skuRpcPayload
    ),
    supabasePostgrestRpc<unknown>(
      supabaseUrl,
      serviceKey,
      "get_shopify_inventory_dashboard",
      {}
    ),
    supabasePostgrestRpc<unknown>(
      supabaseUrl,
      serviceKey,
      "get_shopify_marketing_dashboard",
      marketingRpcPayload
    ),
  ]);

  if (dashRes.error) {
    return NextResponse.json(
      { error: formatRpcError(dashRes.error, "insights-summary") },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }
  if (skuRes.error) {
    return NextResponse.json(
      { error: formatRpcError(skuRes.error, "insights-sku") },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }
  if (invRes.error) {
    return NextResponse.json(
      { error: formatRpcError(invRes.error, "insights-inventory") },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }
  if (marketingRes.error) {
    return NextResponse.json(
      { error: formatRpcError(marketingRes.error, "insights-marketing") },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }

  const rawDash = dashRes.data;
  const dashboard =
    rawDash != null && typeof rawDash === "object" && !Array.isArray(rawDash)
      ? (rawDash as DashboardPayload)
      : null;

  if (!dashboard?.meta || !dashboard.kpis || !Array.isArray(dashboard.dailyRevenue)) {
    return NextResponse.json(
      { error: "Neočekávaný formát odpovede z dashboard RPC." },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }

  const from = String(dashboard.meta.from ?? "").slice(0, 10);
  const to = String(dashboard.meta.to ?? "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    const kpiPayload: Record<string, unknown> = { p_from: from, p_to: to };
    if (pKpi != null) kpiPayload.p_kpi_product = pKpi;
    const kpiRes = await supabasePostgrestRpc<Record<string, unknown>>(
      supabaseUrl,
      serviceKey,
      "get_shopify_dashboard_kpis",
      kpiPayload
    );
    if (kpiRes.error) {
      return NextResponse.json(
        { error: formatRpcError(kpiRes.error, "insights-kpis") },
        { status: 500, headers: jsonNoStoreHeaders }
      );
    }
    if (kpiRes.data && typeof kpiRes.data === "object") {
      dashboard.kpis = mergeKpis(dashboard.kpis, kpiRes.data);
    }
  }

  const skuDailyYtd =
    skuRes.data != null && typeof skuRes.data === "object" && !Array.isArray(skuRes.data)
      ? (skuRes.data as SkuDaily)
      : undefined;

  const inventoryLevels = Array.isArray(invRes.data)
    ? (invRes.data as InventoryRow[])
    : undefined;

  const marketing =
    marketingRes.data != null &&
    typeof marketingRes.data === "object" &&
    !Array.isArray(marketingRes.data)
      ? (marketingRes.data as MarketingPayload)
      : undefined;

  const { risks, opportunities } = evaluateInsights({
    range,
    kpiProduct,
    dashboard,
    skuDailyYtd,
    inventoryLevels,
    marketing,
  });

  const out: InsightsResponse = {
    meta: {
      range: String(dashboard.meta.range ?? range),
      from: String(dashboard.meta.from ?? ""),
      to: String(dashboard.meta.to ?? ""),
      kpi_product: kpiProduct,
    },
    generatedAt: new Date().toISOString(),
    risks,
    opportunities,
  };

  return NextResponse.json(out, { headers: jsonNoStoreHeaders });
}
