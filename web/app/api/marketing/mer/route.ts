import { NextResponse } from "next/server";
import { isAuthorizedRequest } from "@/lib/dashboardAuth";
import { jsonNoStoreHeaders } from "@/lib/apiJsonNoStore";
import { formatRpcError, MISSING_SUPABASE_CONFIG } from "@/lib/formatRpcError";
import { supabasePostgrestRpc } from "@/lib/supabasePostgrestRpc";
import {
  periodToRpcPayload,
  resolvePeriodFromSearchParams,
} from "@/lib/dashboardPeriodApi";
import { getMerTargetsForMonth } from "@/lib/marketingMerTargets";
import {
  resolveScorecardMonth,
  type MerScorecardMode,
} from "@/lib/marketingMerScorecard";

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

  const scorecardMode: MerScorecardMode =
    url.searchParams.get("scorecardMode") === "mtd" ? "mtd" : "completed";
  const scorecardMonth = resolveScorecardMonth(scorecardMode);

  const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: MISSING_SUPABASE_CONFIG },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }

  try {
    const rpcArgs = {
      p_range: range,
      ...(month ? { p_month: month } : {}),
      ...(year ? { p_year: year } : {}),
    };
    const scorecardRpcArgs = {
      p_range: "month",
      p_month: scorecardMonth,
    };
    const [rpcRes, scorecardRes, linesRes] = await Promise.all([
      supabasePostgrestRpc<Record<string, unknown>>(
        supabaseUrl,
        serviceKey,
        "get_shopify_marketing_mer_dashboard",
        rpcArgs
      ),
      supabasePostgrestRpc<Record<string, unknown>>(
        supabaseUrl,
        serviceKey,
        "get_shopify_marketing_mer_dashboard",
        scorecardRpcArgs
      ),
      supabasePostgrestRpc<unknown[]>(
        supabaseUrl,
        serviceKey,
        "get_marketing_mer_expense_lines",
        rpcArgs
      ),
    ]);
    if (rpcRes.error) {
      return NextResponse.json(
        { error: formatRpcError(rpcRes.error, "marketing-mer") },
        { status: 500, headers: jsonNoStoreHeaders }
      );
    }
    if (rpcRes.data == null) {
      return NextResponse.json(
        { error: "MER RPC returned null (invalid range?)" },
        { status: 500, headers: jsonNoStoreHeaders }
      );
    }
    if (scorecardRes.error) {
      return NextResponse.json(
        { error: formatRpcError(scorecardRes.error, "marketing-mer-scorecard") },
        { status: 500, headers: jsonNoStoreHeaders }
      );
    }
    const marketingExpenseLines = Array.isArray(linesRes.data)
      ? linesRes.data
      : [];
    const scorecardPayload = scorecardRes.data ?? {};
    const scorecardKpis =
      (scorecardPayload.kpis as Record<string, unknown> | undefined) ?? null;
    const scorecardKpisForTargets = scorecardPayload.kpis as
      | { revenue?: number }
      | undefined;
    const targets = getMerTargetsForMonth(
      scorecardMonth,
      scorecardKpisForTargets?.revenue
    );
    const bratislavaYm = resolveScorecardMonth("mtd");
    return NextResponse.json(
      {
        ...rpcRes.data,
        marketingExpenseLines,
        scorecard: {
          month: scorecardMonth,
          mode: scorecardMode,
          isMtd: scorecardMode === "mtd" && scorecardMonth === bratislavaYm,
          kpis:
            scorecardPayload.kpis ??
            scorecardPayload.kpisMom ??
            scorecardKpis,
          kpisPrevious: scorecardPayload.kpisPrevious ?? null,
          meta: scorecardPayload.meta ?? null,
          targets,
        },
      },
      { headers: jsonNoStoreHeaders }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: formatRpcError(msg, "marketing-mer") },
      { status: 502, headers: jsonNoStoreHeaders }
    );
  }
}
