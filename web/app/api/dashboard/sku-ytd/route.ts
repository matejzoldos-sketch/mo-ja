import { NextResponse } from "next/server";
import { isAuthorizedRequest } from "@/lib/dashboardAuth";
import { jsonNoStoreHeaders } from "@/lib/apiJsonNoStore";
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
  if (url.searchParams.get("mock") === "1") {
    return NextResponse.json(
      {
        skuDailyYtd: {
          year: 2026,
          from: "2026-01-01",
          to: "2026-04-04",
          skuOrder: ["MOJA Phase", "MOJA Phase+", "DUO pack"],
          points: [
            { date: "2026-01-02", sku: "MOJA Phase", units: 3 },
            { date: "2026-01-02", sku: "MOJA Phase+", units: 1 },
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

  const skuRes = await supabasePostgrestRpc<unknown>(
    supabaseUrl,
    serviceKey,
    "get_shopify_sku_units_daily_ytd",
    {}
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
