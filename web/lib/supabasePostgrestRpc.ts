/**
 * Volanie PostgREST /rpc/* cez fetch — rovnaký kanál ako curl.
 * Obchádza @supabase/supabase-js pri RPC (niektoré prostredia mali rozpor oproti priamemu POST).
 */
export async function supabasePostgrestRpc<T>(
  supabaseUrl: string,
  serviceRoleKey: string,
  rpcName: string,
  payload: Record<string, unknown> = {}
): Promise<{ data: T | null; error: string | null }> {
  const base = supabaseUrl.replace(/\/$/, "");
  const url = `${base}/rest/v1/rpc/${encodeURIComponent(rpcName)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    return { data: null, error: text.trim() || `HTTP ${res.status}` };
  }
  try {
    return { data: JSON.parse(text) as T, error: null };
  } catch {
    return { data: null, error: "Neplatná JSON odpoveď z PostgREST" };
  }
}
