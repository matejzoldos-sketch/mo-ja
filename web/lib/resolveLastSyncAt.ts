import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * PostgREST často vráti TIMESTAMPTZ ako "2026-04-11 11:44:26+00" (medzera namiesto T,
 * offset bez minút). Date.parse na to vráti NaN → resolveLastSyncAt by omylom nechal
 * starší fetched_at namiesto last_success_at.
 */
function parseTimestampToMs(raw: string): number {
  let s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2} \d/.test(s)) {
    s = s.replace(" ", "T");
  }
  if (/[+-]\d{2}$/.test(s) && !/[+-]\d{2}:\d{2}$/.test(s)) {
    s = s.replace(/([+-]\d{2})$/, "$1:00");
  }
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? Number.NaN : ms;
}

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

  let best: string | null = null;
  let bestMs = -Infinity;
  for (const c of candidates) {
    const ms = parseTimestampToMs(c);
    if (!Number.isNaN(ms) && ms > bestMs) {
      best = c;
      bestMs = ms;
    }
  }
  return best ?? candidates[0];
}
