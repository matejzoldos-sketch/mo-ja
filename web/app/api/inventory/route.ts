import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function checkAuth(request: Request): boolean {
  const token = process.env.DASHBOARD_TOKEN;
  if (!token) return true;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${token}`;
}

export async function GET(request: Request) {
  if (!checkAuth(request)) {
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
  const { data, error } = await supabase.rpc("get_shopify_inventory_dashboard");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(Array.isArray(data) ? data : []);
}
