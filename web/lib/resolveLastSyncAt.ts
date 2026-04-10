import type { SupabaseClient } from "@supabase/supabase-js";

/** Najnovší čas z sync_state alebo z riadkov dotknutých syncom (fetched_at). */
export async function resolveLastSyncAt(
  supabase: SupabaseClient
): Promise<string | null> {
  const [syncRes, ordRes, invRes, locRes] = await Promise.all([
    supabase
      .from("shopify_sync_state")
      .select("last_success_at")
      .eq("resource", "full_sync")
      .maybeSingle(),
    supabase
      .from("shopify_orders")
      .select("fetched_at")
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("shopify_inventory_levels")
      .select("fetched_at")
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("shopify_locations")
      .select("fetched_at")
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const candidates: string[] = [];
  if (!syncRes.error && syncRes.data?.last_success_at != null) {
    candidates.push(String(syncRes.data.last_success_at));
  }
  for (const r of [ordRes, invRes, locRes]) {
    if (!r.error && r.data && "fetched_at" in r.data && r.data.fetched_at != null) {
      candidates.push(String(r.data.fetched_at));
    }
  }

  if (candidates.length === 0) return null;

  let best = candidates[0];
  let bestMs = Date.parse(best);
  if (Number.isNaN(bestMs)) bestMs = 0;
  for (let i = 1; i < candidates.length; i++) {
    const ms = Date.parse(candidates[i]);
    if (!Number.isNaN(ms) && ms > bestMs) {
      best = candidates[i];
      bestMs = ms;
    }
  }
  return best;
}
