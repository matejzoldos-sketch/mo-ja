import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { isAuthorizedRequest } from "@/lib/dashboardAuth";

export const dynamic = "force-dynamic";

/** Skryje prázdne / placeholder SKU (sync + DB môžu mať rôzne „dash“ znaky). */
function isRealInventorySku(s: unknown): boolean {
  const t = String(s ?? "").trim();
  if (!t) return false;
  const noDash = t
    .replace(/\u2014/g, "")
    .replace(/\u2013/g, "")
    .replace(/-/g, "");
  return noDash.length > 0;
}

function sanitizeLevels(rows: unknown[]): unknown[] {
  return rows.filter(
    (r) =>
      r &&
      typeof r === "object" &&
      isRealInventorySku((r as { sku?: unknown }).sku)
  );
}

function sanitizeStockChartYtd(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const o = raw as {
    points?: unknown;
    skuOrder?: unknown;
    [key: string]: unknown;
  };
  const points = Array.isArray(o.points)
    ? o.points.filter(
        (p) =>
          p &&
          typeof p === "object" &&
          isRealInventorySku((p as { sku?: unknown }).sku)
      )
    : [];
  const skuOrder = Array.isArray(o.skuOrder)
    ? o.skuOrder.filter((x) => typeof x === "string" && isRealInventorySku(x))
    : [];
  return { ...o, points, skuOrder };
}

export async function GET(request: Request) {
  if (!(await isAuthorizedRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
        error: `Chýba: ${missing.join(", ")}. Vercel → Environment Variables + Redeploy.`,
      },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const [levelsRes, chartRes, syncRes] = await Promise.all([
    supabase.rpc("get_shopify_inventory_dashboard"),
    supabase.rpc("get_shopify_inventory_stock_chart_ytd"),
    supabase
      .from("shopify_sync_state")
      .select("last_success_at")
      .eq("resource", "full_sync")
      .maybeSingle(),
  ]);

  if (levelsRes.error) {
    return NextResponse.json({ error: levelsRes.error.message }, { status: 500 });
  }
  if (chartRes.error) {
    return NextResponse.json({ error: chartRes.error.message }, { status: 500 });
  }

  const levelsRaw = Array.isArray(levelsRes.data) ? levelsRes.data : [];
  const levels = sanitizeLevels(levelsRaw);
  const stockChartYtd = sanitizeStockChartYtd(chartRes.data);
  const lastSyncAt =
    !syncRes.error && syncRes.data?.last_success_at != null
      ? String(syncRes.data.last_success_at)
      : null;

  return NextResponse.json({
    levels,
    stockChartYtd,
    lastSyncAt,
  });
}
