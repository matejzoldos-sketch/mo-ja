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
    defaultRange: "365d",
  });
  const { p_range: range, p_month: month, p_year: year } =
    periodToRpcPayload(period);

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
      "get_shopify_marketing_mer_dashboard",
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
        { error: "MER RPC returned null (invalid range?)" },
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
