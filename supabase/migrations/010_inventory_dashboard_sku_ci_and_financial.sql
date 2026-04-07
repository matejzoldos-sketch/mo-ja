-- Case-insensitive SKU match for sold_by_sku fallback; broaden paid-ish financial_status
-- matching (Shopify display strings can vary slightly).

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
paid_order AS (
  SELECT o.id
  FROM shopify_orders o
  CROSS JOIN bounds b
  WHERE (o.created_at AT TIME ZONE 'Europe/Bratislava')::date BETWEEN b.d0 AND b.d1
    AND (
      UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
        'PAID',
        'PARTIALLY_PAID',
        'PARTIALLY_REFUNDED'
      )
      OR REGEXP_REPLACE(
        UPPER(TRIM(COALESCE(o.financial_status, ''))),
        '[^A-Z]',
        '',
        'g'
      ) IN ('PAID', 'PARTIALLYPAID', 'PARTIALLYREFUNDED')
    )
),
sold_by_inv_item AS (
  SELECT
    li.inventory_item_id,
    SUM(li.quantity)::numeric AS units_sold
  FROM shopify_order_line_items li
  INNER JOIN paid_order po ON po.id = li.order_id
  WHERE li.inventory_item_id IS NOT NULL
  GROUP BY li.inventory_item_id
),
sold_by_sku AS (
  SELECT
    lower(
      trim(
        both
        FROM
          COALESCE(
            NULLIF(TRIM(li.sku), ''),
            NULLIF(TRIM(li.title), ''),
            '—'
          )
      )
    ) AS sku_match_key,
    SUM(li.quantity)::numeric AS units_sold
  FROM shopify_order_line_items li
  INNER JOIN paid_order po ON po.id = li.order_id
  GROUP BY 1
),
inv AS (
  SELECT
    il.inventory_item_id,
    il.location_id,
    l.name AS location_name,
    COALESCE(NULLIF(TRIM(il.raw_json->>'inventoryItemSku'), ''), '—') AS sku,
    lower(
      trim(
        both
        FROM
          COALESCE(NULLIF(TRIM(il.raw_json->>'inventoryItemSku'), ''), '—')
      )
    ) AS sku_match_key,
    il.available,
    il.updated_at,
    il.fetched_at
  FROM shopify_inventory_levels il
  LEFT JOIN shopify_locations l ON l.id = il.location_id
),
joined AS (
  SELECT
    inv.*,
    COALESCE(sbi.units_sold, sy.units_sold, 0)::numeric AS units_sold_ytd
  FROM inv
  LEFT JOIN sold_by_inv_item sbi ON sbi.inventory_item_id = inv.inventory_item_id
  LEFT JOIN sold_by_sku sy ON sy.sku_match_key = inv.sku_match_key
)
SELECT COALESCE(
  json_agg(
    json_build_object(
      'inventory_item_id', j.inventory_item_id,
      'location_id', j.location_id,
      'location_name', j.location_name,
      'sku', j.sku,
      'available', j.available,
      'updated_at', j.updated_at,
      'fetched_at', j.fetched_at,
      'avg_daily_units_sold_ytd',
      CASE
        WHEN nd.n > 0 AND j.units_sold_ytd > 0
        THEN ROUND((j.units_sold_ytd / nd.n)::numeric, 4)
        ELSE NULL
      END,
      'estimated_days_of_stock',
      CASE
        WHEN j.available <= 0 THEN 0::numeric
        WHEN nd.n > 0
          AND j.units_sold_ytd > 0
          AND (j.units_sold_ytd / nd.n) > 0
        THEN ROUND(
          (j.available::numeric / (j.units_sold_ytd / nd.n))::numeric,
          1
        )
        ELSE NULL
      END
    )
    ORDER BY j.location_name NULLS LAST, j.sku, j.inventory_item_id
  ),
  '[]'::json
)
FROM joined j
CROSS JOIN n_days nd;
$$;

COMMENT ON FUNCTION public.get_shopify_inventory_dashboard IS
  'Inventory × location + YTD avg daily units (paid-ish): sales by inventory_item_id, else case-insensitive SKU/title key; sync YTD orders so line_items exist for Jan 1–today';
