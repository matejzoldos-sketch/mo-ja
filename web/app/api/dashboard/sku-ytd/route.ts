import { NextResponse } from "next/server";
import { isAuthorizedRequest } from "@/lib/dashboardAuth";
import { jsonNoStoreHeaders } from "@/lib/apiJsonNoStore";
import { supabasePostgrestRpc } from "@/lib/supabasePostgrestRpc";

export const dynamic = "force-dynamic";

const ALLOWED_RANGE = new Set(["ytd", "30d", "90d", "365d"]);
const ALLOWED_KPI_PRODUCT = new Set(["all", "moja_phase_bez", "moja_phase_plus"]);

function resolveSkuRange(searchParams: URLSearchParams): string {
  const raw = searchParams.get("range")?.toLowerCase().trim() ?? "";
  if (!raw) return "ytd";
  if (ALLOWED_RANGE.has(raw)) return raw;
  return "ytd";
}

export async function GET(request: Request) {
  if (!(await isAuthorizedRequest(request))) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: jsonNoStoreHeaders }
    );
  }

  const url = new URL(request.url);
  const pRange = resolveSkuRange(url.searchParams);
  const rawKpi =
    url.searchParams.get("kpi_product")?.toLowerCase().trim() ?? "";
  const kpiProductEarly = ALLOWED_KPI_PRODUCT.has(rawKpi) ? rawKpi : "all";
  const pKpiProduct =
    kpiProductEarly === "all" ? null : kpiProductEarly;

  if (url.searchParams.get("mock") === "1") {
    const mockSkus =
      kpiProductEarly === "moja_phase_bez"
        ? ["MOJA Phase bez fytoestrogénov"]
        : kpiProductEarly === "moja_phase_plus"
          ? ["MOJA Phase+ s fytoestrogénmi"]
          : ["MOJA Phase", "MOJA Phase+", "DUO pack"];
    return NextResponse.json(
      {
        skuDailyYtd: {
          year: 2026,
          range: pRange,
          from: "2026-01-01",
          to: "2026-04-04",
          kpi_product: kpiProductEarly,
          skuOrder: mockSkus,
          points: [
            {
              date: "2026-01-02",
              sku: mockSkus[0] ?? "MOJA Phase",
              units: 3,
            },
            {
              date: "2026-01-05",
              sku: mockSkus[0] ?? "MOJA Phase",
              units: 2,
            },
          ],
        },
      },
      { headers: jsonNoStoreHeaders }
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
        error: `Chýba: ${missing.join(", ")}. Vercel → Project → Settings → Environment Variables.`,
      },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }

  const skuRpcPayload: Record<string, unknown> = { p_range: pRange };
  if (pKpiProduct != null) skuRpcPayload.p_kpi_product = pKpiProduct;

  const skuRes = await supabasePostgrestRpc<unknown>(
    supabaseUrl,
    serviceKey,
    "get_shopify_sku_units_daily_ytd",
    skuRpcPayload
  );

  if (skuRes.error) {
    return NextResponse.json(
      { error: skuRes.error },
      { status: 500, headers: jsonNoStoreHeaders }
    );
  }

  return NextResponse.json(
    { skuDailyYtd: skuRes.data },
    { headers: jsonNoStoreHeaders }
  );
}
