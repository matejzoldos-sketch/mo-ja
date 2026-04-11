import type { SupabaseClient } from "@supabase/supabase-js";

function unknownToIsoString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v.toISOString();
  }
  return null;
}

/**
 * PostgREST často vráti TIMESTAMPTZ ako "2026-04-11 11:44:26+00" (medzera namiesto T,
 * offset bez minút). Date.parse na to vráti NaN → resolveLastSyncAt by omylom nechal
 * starší fetched_at namiesto last_success_at.
 */
function parseTimestampToMs(raw: string): number {
  let s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}\s/.test(s)) {
    s = s.replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T");
  }
  if (/[+-]\d{2}$/.test(s) && !/[+-]\d{2}:\d{2}$/.test(s)) {
    s = s.replace(/([+-]\d{2})$/, "$1:00");
  }
  let ms = Date.parse(s);
  if (!Number.isNaN(ms)) return ms;
  ms = new Date(s).getTime();
  return Number.isNaN(ms) ? Number.NaN : ms;
}

/** Najnovší čas z sync_state alebo z riadkov dotknutých syncom (fetched_at). */
export async function resolveLastSyncAt(
  supabase: SupabaseClient
): Promise<string | null> {
  const rpcRes = await supabase.rpc("get_dashboard_last_sync_at");
  if (!rpcRes.error && rpcRes.data != null) {
    const iso = unknownToIsoString(rpcRes.data);
    if (iso != null) return iso;
  }

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
    const s = unknownToIsoString(syncRes.data.last_success_at);
    if (s != null) candidates.push(s);
    else candidates.push(String(syncRes.data.last_success_at));
  }
  for (const r of [ordRes, invRes, locRes]) {
    if (!r.error && r.data && "fetched_at" in r.data && r.data.fetched_at != null) {
      const s = unknownToIsoString(
        (r.data as { fetched_at: unknown }).fetched_at
      );
      if (s != null) candidates.push(s);
      else candidates.push(String((r.data as { fetched_at: unknown }).fetched_at));
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
