-- Skladová tabuľka: namiesto estimated_days_of_stock vráti estimated_stockout_date (dnes SK + zaokr. kalendárne dni podľa YTD spotreby).

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
      UPPER(
        REPLACE(
          TRIM(
            COALESCE(
              NULLIF(TRIM(o.financial_status), ''),
              NULLIF(TRIM(o.raw_json->>'displayFinancialStatus'), ''),
              ''
            )
          ),
          ' ',
          '_'
        )
      ) IN (
        'PAID',
        'PARTIALLY_PAID',
        'PARTIALLY_REFUNDED',
        'AUTHORIZED',
        'AUTHORISED'
      )
      OR REGEXP_REPLACE(
        UPPER(
          TRIM(
            COALESCE(
              NULLIF(TRIM(o.financial_status), ''),
              NULLIF(TRIM(o.raw_json->>'displayFinancialStatus'), ''),
              ''
            )
          )
        ),
        '[^A-Z]',
        '',
        'g'
      ) IN (
        'PAID',
        'PARTIALLYPAID',
        'PARTIALLYREFUNDED',
        'AUTHORIZED',
        'AUTHORISED'
      )
      OR (
        UPPER(
          TRIM(
            COALESCE(
              NULLIF(TRIM(o.financial_status), ''),
              NULLIF(TRIM(o.raw_json->>'displayFinancialStatus'), ''),
              ''
            )
          )
        ) LIKE '%PAID%'
        AND UPPER(
          TRIM(
            COALESCE(
              NULLIF(TRIM(o.financial_status), ''),
              NULLIF(TRIM(o.raw_json->>'displayFinancialStatus'), ''),
              ''
            )
          )
        ) NOT LIKE '%UNPAID%'
      )
    )
),
line_eff AS (
  SELECT
    li.order_id,
    li.line_item_id,
    GREATEST(
      0::numeric,
      COALESCE(
        li.quantity::numeric,
        (NULLIF(TRIM(li.raw_json->>'currentQuantity'), ''))::numeric,
        (NULLIF(TRIM(li.raw_json->>'quantity'), ''))::numeric,
        0::numeric
      )
    ) AS qty,
    COALESCE(
      li.inventory_item_id,
      CASE
        WHEN COALESCE(li.raw_json #>> '{variant,inventoryItem,id}', '') ~ '[0-9]'
        THEN (SUBSTRING(li.raw_json #>> '{variant,inventoryItem,id}' FROM '([0-9]+)$'))::bigint
        ELSE NULL
      END,
      CASE
        WHEN (li.raw_json->'variant'->'inventoryItem'->>'legacyResourceId') ~ '^[0-9]+$'
        THEN (li.raw_json->'variant'->'inventoryItem'->>'legacyResourceId')::bigint
        ELSE NULL
      END
    ) AS eff_inventory_item_id,
    translate(
      lower(
        trim(
          both
          FROM
            COALESCE(
              NULLIF(TRIM(li.sku), ''),
              NULLIF(TRIM(li.raw_json #>> '{variant,sku}'), ''),
              NULLIF(TRIM(li.raw_json->>'variantTitle'), ''),
              NULLIF(TRIM(li.title), ''),
              NULLIF(TRIM(li.raw_json->>'name'), ''),
              '—'
            )
        )
      ),
      chr(65339) || chr(65122),
      '++'
    ) AS sku_match_key
  FROM shopify_order_line_items li
),
sold_by_inv_item AS (
  SELECT
    le.eff_inventory_item_id AS inventory_item_id,
    SUM(le.qty)::numeric AS units_sold
  FROM line_eff le
  INNER JOIN paid_order po ON po.id = le.order_id
  WHERE le.eff_inventory_item_id IS NOT NULL
    AND le.qty > 0
  GROUP BY le.eff_inventory_item_id
),
sold_by_sku AS (
  SELECT
    le.sku_match_key,
    SUM(le.qty)::numeric AS units_sold
  FROM line_eff le
  INNER JOIN paid_order po ON po.id = le.order_id
  WHERE le.qty > 0
  GROUP BY le.sku_match_key
),
inv AS (
  SELECT
    il.inventory_item_id,
    il.location_id,
    l.name AS location_name,
    BTRIM(il.raw_json->>'inventoryItemSku') AS sku,
    translate(
      lower(
        trim(
          both
          FROM
            BTRIM(il.raw_json->>'inventoryItemSku')
        )
      ),
      chr(65339) || chr(65122),
      '++'
    ) AS sku_match_key,
    il.available,
    il.updated_at,
    il.fetched_at
  FROM shopify_inventory_levels il
  LEFT JOIN shopify_locations l ON l.id = il.location_id
  WHERE NULLIF(BTRIM(il.raw_json->>'inventoryItemSku'), '') IS NOT NULL
    AND NULLIF(
      regexp_replace(
        regexp_replace(
          regexp_replace(BTRIM(il.raw_json->>'inventoryItemSku'), chr(8212), '', 'g'),
          chr(8211),
          '',
          'g'
        ),
        '-',
        '',
        'g'
      ),
      ''
    ) IS NOT NULL
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
      'estimated_stockout_date',
      CASE
        WHEN j.available <= 0 THEN b.d1
        WHEN nd.n > 0
          AND j.units_sold_ytd > 0
          AND (j.units_sold_ytd / nd.n) > 0
        THEN (b.d1 + ROUND(
          (j.available::numeric / (j.units_sold_ytd / nd.n))::numeric,
          0
        )::integer)
        ELSE NULL
      END
    )
    ORDER BY j.location_name NULLS LAST, j.sku, j.inventory_item_id
  ),
  '[]'::json
)
FROM joined j
CROSS JOIN n_days nd
CROSS JOIN bounds b;
$$;

COMMENT ON FUNCTION public.get_shopify_inventory_dashboard IS
  'Inventory × location + YTD avg daily units; estimated_stockout_date = Bratislava today + round(available/daily_rate) calendar days; paid-ish match; non-empty inventoryItemSku only';
