-- Jedno číslo v DB = žiadne Date.parse rozdiely medzi Node a PostgREST string formátmi.

CREATE OR REPLACE FUNCTION public.get_dashboard_last_sync_at()
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(
    (SELECT s.last_success_at FROM public.shopify_sync_state s WHERE s.resource = 'full_sync'),
    (SELECT MAX(o.fetched_at) FROM public.shopify_orders o),
    (SELECT MAX(i.fetched_at) FROM public.shopify_inventory_levels i),
    (SELECT MAX(l.fetched_at) FROM public.shopify_locations l)
  );
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_last_sync_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dashboard_last_sync_at() TO service_role;

COMMENT ON FUNCTION public.get_dashboard_last_sync_at() IS 'Max(full_sync.last_success_at, max fetched_at orders/inventory_levels/locations); pre Posledný sync na webe.';
