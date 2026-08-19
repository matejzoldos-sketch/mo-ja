import { NextResponse } from "next/server";
import { isAuthorizedRequest } from "@/lib/dashboardAuth";
import { jsonNoStoreHeaders } from "@/lib/apiJsonNoStore";
import { formatRpcError, MISSING_SUPABASE_CONFIG } from "@/lib/formatRpcError";
import { supabasePostgrestRpc } from "@/lib/supabasePostgrestRpc";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await isAuthorizedRequest(request))) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: jsonNoStoreHeaders }
    );
  }

  const url = new URL(request.url);
  const year = url.searchParams.get("year") ?? undefined;
  const mode = (url.searchParams.get("mode") ?? "accounting").toLowerCase();
  const apiMode = mode === "hybrid" ? "xls" : mode;
  const rpcName = apiMode === "xls" ? "get_pnl_xls_dashboard" : "get_pnl_dashboard";

  const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: MISSING_SUPABASE_CONFIG },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }

  try {
    const rpcRes = await supabasePostgrestRpc<Record<string, unknown>>(
      supabaseUrl,
      serviceKey,
      rpcName,
      { ...(year ? { p_year: year } : {}) }
    );
    if (rpcRes.error) {
      return NextResponse.json(
        { error: formatRpcError(rpcRes.error, "pnl") },
        { status: 500, headers: jsonNoStoreHeaders }
      );
    }
    if (rpcRes.data == null) {
      return NextResponse.json(
        { error: "P&L RPC returned null" },
        { status: 500, headers: jsonNoStoreHeaders }
      );
    }

    // Always fetch topExpenses from accounting RPC so we can show
    // the same supplier table + filters in all dashboard modes.
    if (apiMode === "xls") {
      const accountingRes = await supabasePostgrestRpc<Record<string, unknown>>(
        supabaseUrl,
        serviceKey,
        "get_pnl_dashboard",
        { ...(year ? { p_year: year } : {}) }
      );
      if (accountingRes.error || accountingRes.data == null) {
        return NextResponse.json(
          { ...(rpcRes.data as Record<string, unknown>), topExpenses: [] },
          { headers: jsonNoStoreHeaders }
        );
      }

      const topExpenses =
        (accountingRes.data as Record<string, unknown>).topExpenses ?? [];

      return NextResponse.json(
        { ...(rpcRes.data as Record<string, unknown>), topExpenses },
        { headers: jsonNoStoreHeaders }
      );
    }

    return NextResponse.json(rpcRes.data, { headers: jsonNoStoreHeaders });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: formatRpcError(msg, "pnl") },
      { status: 502, headers: jsonNoStoreHeaders }
    );
  }
}
