import { NextResponse } from "next/server";
import { isAuthorizedRequest } from "@/lib/dashboardAuth";
import { jsonNoStoreHeaders } from "@/lib/apiJsonNoStore";
import { supabasePostgrestRpc } from "@/lib/supabasePostgrestRpc";
import { evaluateInsights } from "@/lib/insights/evaluate";
import type { DashboardPayload, InsightsResponse, SkuDaily } from "@/lib/insights/types";

export const dynamic = "force-dynamic";

const ALLOWED_RANGE = new Set(["30d", "90d", "365d", "ytd"]);
const ALLOWED_KPI_PRODUCT = new Set(["all", "moja_phase_bez", "moja_phase_plus"]);

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

  const dashRpcPayload: Record<string, unknown> = { p_range: range };
  if (pKpi != null) dashRpcPayload.p_kpi_product = pKpi;
  const skuRpcPayload: Record<string, unknown> = { p_range: range };
  if (pKpi != null) skuRpcPayload.p_kpi_product = pKpi;

  const [dashRes, skuRes] = await Promise.all([
    supabasePostgrestRpc<unknown>(
      supabaseUrl,
      serviceKey,
      "get_shopify_dashboard_mvp",
      dashRpcPayload
    ),
    supabasePostgrestRpc<unknown>(
      supabaseUrl,
      serviceKey,
      "get_shopify_sku_units_daily_ytd",
      skuRpcPayload
    ),
  ]);

  if (dashRes.error) {
    return NextResponse.json(
      { error: dashRes.error },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }
  if (skuRes.error) {
    return NextResponse.json(
      { error: skuRes.error },
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

  const skuDailyYtd =
    skuRes.data != null && typeof skuRes.data === "object" && !Array.isArray(skuRes.data)
      ? (skuRes.data as SkuDaily)
      : undefined;

  const { risks, opportunities } = evaluateInsights({
    range,
    kpiProduct,
    dashboard,
    skuDailyYtd,
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

