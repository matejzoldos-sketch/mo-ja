import { NextResponse } from "next/server";
import { jsonNoStoreHeaders } from "@/lib/apiJsonNoStore";
import { isAuthorizedRequest } from "@/lib/dashboardAuth";
import { formatRpcError, MISSING_SUPABASE_CONFIG } from "@/lib/formatRpcError";
import { resolveLastSyncAt } from "@/lib/resolveLastSyncAt";
import { supabasePostgrestRpc } from "@/lib/supabasePostgrestRpc";

type Sales30dRow = { sku: string; qty_30d: number; per_day: number };

type PhysicalInventoryPayload = {
  latestMonthKey: string | null;
  rows: Array<{
    month_key: string;
    product_key: string;
    product_label: string;
    stock_end: number;
    stock_in?: number | null;
    stock_out?: number | null;
    shopify_out?: number | null;
    imported_at?: string;
  }>;
  history?: unknown[];
  importedAt?: string | null;
};

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
    return NextResponse.json(
      { error: MISSING_SUPABASE_CONFIG },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }

  const [levelsRes, chartRes, physicalRes, sales30dRes, lastSyncAt] =
    await Promise.all([
      supabasePostgrestRpc<unknown>(
        supabaseUrl,
        serviceKey,
        "get_shopify_inventory_dashboard",
        {}
      ),
      supabasePostgrestRpc<unknown>(
        supabaseUrl,
        serviceKey,
        "get_shopify_inventory_stock_chart_ytd",
        {}
      ),
      supabasePostgrestRpc<PhysicalInventoryPayload>(
        supabaseUrl,
        serviceKey,
        "get_physical_inventory_dashboard",
        {}
      ),
      supabasePostgrestRpc<Sales30dRow[]>(
        supabaseUrl,
        serviceKey,
        "get_inventory_sales_30d_by_sku",
        {}
      ),
      resolveLastSyncAt(supabaseUrl, serviceKey),
    ]);

  if (levelsRes.error) {
    return NextResponse.json(
      { error: formatRpcError(levelsRes.error, "inventory") },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }
  if (chartRes.error) {
    return NextResponse.json(
      { error: formatRpcError(chartRes.error, "inventory-chart") },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }

  const levelsRaw = Array.isArray(levelsRes.data) ? levelsRes.data : [];
  const sales30dBySku = new Map<string, Sales30dRow>();
  if (Array.isArray(sales30dRes.data)) {
    for (const row of sales30dRes.data) {
      if (row?.sku) sales30dBySku.set(row.sku, row);
    }
  }

  const levels = sanitizeLevels(levelsRaw).map((row) => {
    if (!row || typeof row !== "object") return row;
    const sku = String((row as { sku?: unknown }).sku ?? "");
    const sales = sales30dBySku.get(sku);
    const available = Number((row as { available?: unknown }).available ?? 0);
    let estimatedStockoutDate30d: string | null = null;
    if (sales && sales.per_day > 0 && available > 0) {
      const days = Math.round(available / sales.per_day);
      const d = new Date();
      d.setDate(d.getDate() + days);
      estimatedStockoutDate30d = d.toISOString().slice(0, 10);
    }
    return {
      ...row,
      avg_daily_units_sold_30d: sales?.per_day ?? null,
      units_sold_30d: sales?.qty_30d ?? null,
      estimated_stockout_date_30d: estimatedStockoutDate30d,
    };
  });

  const stockChartYtd = sanitizeStockChartYtd(chartRes.data);
  const physical =
    physicalRes.error || !physicalRes.data
      ? null
      : {
          latestMonthKey: physicalRes.data.latestMonthKey ?? null,
          rows: physicalRes.data.rows ?? [],
          importedAt: physicalRes.data.importedAt ?? null,
        };

  return NextResponse.json(
    {
      levels,
      stockChartYtd,
      physical,
      lastSyncAt,
    },
    { headers: jsonNoStoreHeaders }
  );
}
