import { supabasePostgrestGet, supabasePostgrestRpc } from "./supabasePostgrestRpc";

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

async function lastSyncFromTableFallback(
  supabaseUrl: string,
  serviceKey: string
): Promise<string | null> {
  const [syncRes, ordRes, invRes, locRes] = await Promise.all([
    supabasePostgrestGet<Array<{ last_success_at?: unknown }>>(
      supabaseUrl,
      serviceKey,
      "shopify_sync_state?select=last_success_at&resource=eq.full_sync&limit=1"
    ),
    supabasePostgrestGet<Array<{ fetched_at?: unknown }>>(
      supabaseUrl,
      serviceKey,
      "shopify_orders?select=fetched_at&order=fetched_at.desc&limit=1"
    ),
    supabasePostgrestGet<Array<{ fetched_at?: unknown }>>(
      supabaseUrl,
      serviceKey,
      "shopify_inventory_levels?select=fetched_at&order=fetched_at.desc&limit=1"
    ),
    supabasePostgrestGet<Array<{ fetched_at?: unknown }>>(
      supabaseUrl,
      serviceKey,
      "shopify_locations?select=fetched_at&order=fetched_at.desc&limit=1"
    ),
  ]);

  const candidates: string[] = [];
  const syncRow = syncRes.data?.[0];
  if (!syncRes.error && syncRow?.last_success_at != null) {
    const s = unknownToIsoString(syncRow.last_success_at);
    if (s != null) candidates.push(s);
    else candidates.push(String(syncRow.last_success_at));
  }
  for (const res of [ordRes, invRes, locRes]) {
    const row = res.data?.[0];
    if (!res.error && row && "fetched_at" in row && row.fetched_at != null) {
      const s = unknownToIsoString(row.fetched_at);
      if (s != null) candidates.push(s);
      else candidates.push(String(row.fetched_at));
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

/** Najnovší čas z sync_state alebo z riadkov dotknutých syncom (fetched_at). Len PostgREST fetch. */
export async function resolveLastSyncAt(
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<string | null> {
  const rpcRes = await supabasePostgrestRpc<unknown>(
    supabaseUrl,
    serviceRoleKey,
    "get_dashboard_last_sync_at",
    {}
  );
  if (!rpcRes.error && rpcRes.data != null) {
    const iso = unknownToIsoString(rpcRes.data);
    if (iso != null) return iso;
  }

  return lastSyncFromTableFallback(supabaseUrl, serviceRoleKey);
}
