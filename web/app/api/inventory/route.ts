import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { isAuthorizedRequest } from "@/lib/dashboardAuth";

export const dynamic = "force-dynamic";

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
  const [levelsRes, chartRes] = await Promise.all([
    supabase.rpc("get_shopify_inventory_dashboard"),
    supabase.rpc("get_shopify_inventory_stock_chart_ytd"),
  ]);

  if (levelsRes.error) {
    return NextResponse.json({ error: levelsRes.error.message }, { status: 500 });
  }
  if (chartRes.error) {
    return NextResponse.json({ error: chartRes.error.message }, { status: 500 });
  }

  const levels = Array.isArray(levelsRes.data) ? levelsRes.data : [];
  return NextResponse.json({
    levels,
    stockChartYtd: chartRes.data,
  });
}
