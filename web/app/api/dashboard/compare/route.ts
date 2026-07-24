import { NextResponse } from "next/server";
import { isAuthorizedRequest } from "@/lib/dashboardAuth";
import { jsonNoStoreHeaders } from "@/lib/apiJsonNoStore";
import { supabasePostgrestRpc } from "@/lib/supabasePostgrestRpc";
import {
  periodToRpcPayload,
  resolvePeriodFromSearchParams,
} from "@/lib/dashboardPeriodApi";
import {
  previousPeriodBounds,
  previousPeriodLabel,
} from "@/lib/dashboardPeriodCompare";

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
  const kpiProduct = ALLOWED_KPI_PRODUCT.has(rawKpi) ? rawKpi : "all";
  const pKpiProduct = kpiProduct === "all" ? null : kpiProduct;

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

  const summaryPayload: Record<string, unknown> = { p_range: pRange };
  if (pMonth) summaryPayload.p_month = pMonth;
  if (pYear) summaryPayload.p_year = pYear;
  if (pKpiProduct != null) summaryPayload.p_kpi_product = pKpiProduct;

  const summaryRes = await supabasePostgrestRpc<Record<string, unknown>>(
    supabaseUrl,
    serviceKey,
    "get_shopify_dashboard_summary",
    summaryPayload
  );
  if (summaryRes.error || !summaryRes.data) {
    return NextResponse.json(
      { error: `[dashboard-compare:summary] ${summaryRes.error || "Summary RPC failed"}` },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }

  const meta =
    typeof summaryRes.data.meta === "object" && summaryRes.data.meta != null
      ? (summaryRes.data.meta as Record<string, unknown>)
      : null;
  const from = typeof meta?.from === "string" ? meta.from : null;
  const to = typeof meta?.to === "string" ? meta.to : null;
  if (!from || !to) {
    return NextResponse.json(
      { kpisPrevious: null, compareMeta: null },
      { headers: jsonNoStoreHeaders }
    );
  }

  const prevBounds = previousPeriodBounds(from, to);
  if (!prevBounds) {
    return NextResponse.json(
      { kpisPrevious: null, compareMeta: null },
      { headers: jsonNoStoreHeaders }
    );
  }

  const kpiArgs = (pFrom: string, pTo: string) => ({
    p_from: pFrom,
    p_to: pTo,
    ...(pKpiProduct != null ? { p_kpi_product: pKpiProduct } : {}),
  });

  // Current + previous via the light KPI RPC. Current customer scorecards are
  // intentionally NULL in get_shopify_dashboard_summary and only appear after
  // analytics MVP — which often statement-timeouts — so fill them here too.
  const [prevRes, currentRes] = await Promise.all([
    supabasePostgrestRpc<Record<string, unknown>>(
      supabaseUrl,
      serviceKey,
      "get_shopify_dashboard_kpis",
      kpiArgs(prevBounds.from, prevBounds.to)
    ),
    supabasePostgrestRpc<Record<string, unknown>>(
      supabaseUrl,
      serviceKey,
      "get_shopify_dashboard_kpis",
      kpiArgs(from.slice(0, 10), to.slice(0, 10))
    ),
  ]);
  if (prevRes.error) {
    return NextResponse.json(
      { error: `[dashboard-compare:kpis] ${prevRes.error}` },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }

  return NextResponse.json(
    {
      kpisPrevious: prevRes.data ?? null,
      kpisCurrent: currentRes.error ? null : currentRes.data ?? null,
      compareMeta: {
        compareFrom: prevBounds.from,
        compareTo: prevBounds.to,
        compareLabel: previousPeriodLabel(prevBounds.from, prevBounds.to),
      },
    },
    { headers: jsonNoStoreHeaders }
  );
}
