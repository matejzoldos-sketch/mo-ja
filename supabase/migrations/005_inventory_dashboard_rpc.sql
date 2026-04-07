-- JSON list of current inventory levels per location for MO–JA sklad page.

CREATE OR REPLACE FUNCTION public.get_shopify_inventory_dashboard()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'inventory_item_id', q.inventory_item_id,
        'location_id', q.location_id,
        'location_name', q.location_name,
        'sku', q.sku,
        'available', q.available,
        'updated_at', q.updated_at,
        'fetched_at', q.fetched_at
      )
      ORDER BY q.location_name NULLS LAST, q.sku, q.inventory_item_id
    ),
    '[]'::json
  )
  FROM (
    SELECT
      il.inventory_item_id,
      il.location_id,
      l.name AS location_name,
      COALESCE(NULLIF(TRIM(il.raw_json->>'inventoryItemSku'), ''), '—') AS sku,
      il.available,
      il.updated_at,
      il.fetched_at
    FROM shopify_inventory_levels il
    LEFT JOIN shopify_locations l ON l.id = il.location_id
  ) q;
$$;

REVOKE ALL ON FUNCTION public.get_shopify_inventory_dashboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shopify_inventory_dashboard() TO service_role;

COMMENT ON FUNCTION public.get_shopify_inventory_dashboard IS 'Current Shopify inventory levels × location for dashboard (SKU from sync raw_json)';
