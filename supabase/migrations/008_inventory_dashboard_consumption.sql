-- Sklad table: YTD avg daily units sold per SKU label + estimated days of stock (available / avg).

CREATE OR REPLACE FUNCTION public.get_shopify_inventory_dashboard()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH bounds AS (
  SELECT
    make_date(
      EXTRACT(YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Bratislava'))::int,
      1,
      1
    ) AS d0,
    (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Bratislava')::date AS d1
),
n_days AS (
  SELECT GREATEST(1, (b.d1 - b.d0 + 1))::numeric AS n
  FROM bounds b
),
sold_ytd AS (
  SELECT
    COALESCE(
      NULLIF(TRIM(li.sku), ''),
      NULLIF(TRIM(li.title), ''),
      '—'
    ) AS sku_label,
    SUM(li.quantity)::numeric AS units_sold
  FROM shopify_order_line_items li
  INNER JOIN shopify_orders o ON o.id = li.order_id
  CROSS JOIN bounds b
  WHERE (o.created_at AT TIME ZONE 'Europe/Bratislava')::date BETWEEN b.d0 AND b.d1
    AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
      'PAID',
      'PARTIALLY_PAID',
      'PARTIALLY_REFUNDED'
    )
  GROUP BY 1
),
inv AS (
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
)
SELECT COALESCE(
  json_agg(
    json_build_object(
      'inventory_item_id', inv.inventory_item_id,
      'location_id', inv.location_id,
      'location_name', inv.location_name,
      'sku', inv.sku,
      'available', inv.available,
      'updated_at', inv.updated_at,
      'fetched_at', inv.fetched_at,
      'avg_daily_units_sold_ytd',
      CASE
        WHEN nd.n > 0 AND COALESCE(sy.units_sold, 0) > 0
        THEN ROUND((sy.units_sold / nd.n)::numeric, 4)
        ELSE NULL
      END,
      'estimated_days_of_stock',
      CASE
        WHEN inv.available <= 0 THEN 0::numeric
        WHEN nd.n > 0
          AND COALESCE(sy.units_sold, 0) > 0
          AND (sy.units_sold / nd.n) > 0
        THEN ROUND(
          (inv.available::numeric / (sy.units_sold / nd.n))::numeric,
          1
        )
        ELSE NULL
      END
    )
    ORDER BY inv.location_name NULLS LAST, inv.sku, inv.inventory_item_id
  ),
  '[]'::json
)
FROM inv
CROSS JOIN n_days nd
LEFT JOIN sold_ytd sy ON sy.sku_label = inv.sku;
$$;

COMMENT ON FUNCTION public.get_shopify_inventory_dashboard IS
  'Inventory levels × location + YTD avg daily units sold per SKU (paid-ish) + available/avg days estimate';
