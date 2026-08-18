const POSTGREST_TIMEOUT_MS = 25_000;

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  );
}

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
  let res: Response;
  try {
    res = await fetch(url, {
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
      signal: AbortSignal.timeout(POSTGREST_TIMEOUT_MS),
    });
  } catch (err) {
    if (isAbortError(err)) {
      return { data: null, error: "statement timeout" };
    }
    return {
      data: null,
      error: err instanceof Error ? err.message : "network error",
    };
  }
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

/**
 * GET na `/rest/v1/<path>` (napr. `shopify_orders?select=id&limit=1`) — rovnaké hlavičky ako pri RPC.
 * `path` nesmie začínať lomkou.
 */
export async function supabasePostgrestGet<T>(
  supabaseUrl: string,
  serviceRoleKey: string,
  path: string
): Promise<{ data: T | null; error: string | null }> {
  const base = supabaseUrl.replace(/\/$/, "");
  const rel = path.replace(/^\//, "");
  const url = `${base}/rest/v1/${rel}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(POSTGREST_TIMEOUT_MS),
    });
  } catch (err) {
    if (isAbortError(err)) {
      return { data: null, error: "statement timeout" };
    }
    return {
      data: null,
      error: err instanceof Error ? err.message : "network error",
    };
  }
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
