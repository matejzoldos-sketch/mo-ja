import { NextResponse } from "next/server";
import { isAuthorizedRequest } from "@/lib/dashboardAuth";
import { jsonNoStoreHeaders } from "@/lib/apiJsonNoStore";
import { supabasePostgrestRpc } from "@/lib/supabasePostgrestRpc";
import {
  periodToRpcPayload,
  resolvePeriodFromSearchParams,
} from "@/lib/dashboardPeriodApi";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await isAuthorizedRequest(request))) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: jsonNoStoreHeaders }
    );
  }

  const url = new URL(request.url);
  const period = resolvePeriodFromSearchParams(url.searchParams, {
    defaultRange: "90d",
  });
  const { p_range: range, p_month: month, p_year: year } =
    periodToRpcPayload(period);

  if (url.searchParams.get("mock") === "1") {
    return NextResponse.json(
      {
        meta: { range, from: "2026-01-01", to: "2026-05-27" },
        kpis: {
          orders: 120,
          orders_with_utm: 95,
          orders_without_utm: 25,
          revenue: 12450.5,
          currency: "EUR",
          pct_orders_with_utm: 79.2,
        },
        bySource: [
          { label: "Meta Ads", orders: 40, revenue: 4200, pct_orders: 33.3, pct_revenue: 33.7 },
          { label: "Direct", orders: 35, revenue: 3800, pct_orders: 29.2, pct_revenue: 30.5 },
          { label: "Instagram", orders: 25, revenue: 2500, pct_orders: 20.8, pct_revenue: 20.1 },
        ],
        byMedium: [
          { label: "cpc", orders: 45, revenue: 4800, pct_orders: 37.5, pct_revenue: 38.6 },
          { label: "—", orders: 30, revenue: 3100, pct_orders: 25.0, pct_revenue: 24.9 },
        ],
        byCampaign: [
          { label: "spring_launch", orders: 20, revenue: 2100, pct_orders: 16.7, pct_revenue: 16.9 },
        ],
        recentOrders: [],
      },
      { headers: jsonNoStoreHeaders }
    );
  }

  const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }

  try {
    const rpcRes = await supabasePostgrestRpc<Record<string, unknown>>(
      supabaseUrl,
      serviceKey,
      "get_shopify_marketing_dashboard",
      {
        p_range: range,
        ...(month ? { p_month: month } : {}),
        ...(year ? { p_year: year } : {}),
      }
    );
    if (rpcRes.error) {
      return NextResponse.json(
        { error: rpcRes.error },
        { status: 500, headers: jsonNoStoreHeaders }
      );
    }
    if (rpcRes.data == null) {
      return NextResponse.json(
        { error: "Marketing RPC returned null (invalid range?)" },
        { status: 500, headers: jsonNoStoreHeaders }
      );
    }
    return NextResponse.json(rpcRes.data, { headers: jsonNoStoreHeaders });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: msg },
      { status: 502, headers: jsonNoStoreHeaders }
    );
  }
}
