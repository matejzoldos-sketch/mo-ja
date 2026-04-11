import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { jsonNoStoreHeaders } from "@/lib/apiJsonNoStore";
import { isAuthorizedRequest } from "@/lib/dashboardAuth";
import { resolveLastSyncAt } from "@/lib/resolveLastSyncAt";
import { supabasePostgrestRpc } from "@/lib/supabasePostgrestRpc";

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
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: jsonNoStoreHeaders }
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
        error: `Chýba: ${missing.join(", ")}. Vercel → Environment Variables + Redeploy.`,
      },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const [levelsRes, chartRes, lastSyncAt] = await Promise.all([
    supabasePostgrestRpc<unknown>(supabaseUrl, serviceKey, "get_shopify_inventory_dashboard", {}),
    supabasePostgrestRpc<unknown>(supabaseUrl, serviceKey, "get_shopify_inventory_stock_chart_ytd", {}),
    resolveLastSyncAt(supabase),
  ]);

  if (levelsRes.error) {
    return NextResponse.json(
      { error: levelsRes.error },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }
  if (chartRes.error) {
    return NextResponse.json(
      { error: chartRes.error },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }

  const levelsRaw = Array.isArray(levelsRes.data) ? levelsRes.data : [];
  const levels = sanitizeLevels(levelsRaw);
  const stockChartYtd = sanitizeStockChartYtd(chartRes.data);
  return NextResponse.json(
    {
      levels,
      stockChartYtd,
      lastSyncAt,
    },
    { headers: jsonNoStoreHeaders }
  );
}
