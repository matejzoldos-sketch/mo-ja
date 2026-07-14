-- Sklad YTD graf: top 10 kanonických produktov (nie SKU); denné body = súčet zásob aliasov.

CREATE OR REPLACE FUNCTION public.get_shopify_inventory_stock_chart_ytd()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH bounds AS (
  SELECT
    EXTRACT(YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Bratislava'))::int AS y,
    make_date(
      EXTRACT(YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Bratislava'))::int,
      4,
      7
    ) AS chart_d0,
    (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Bratislava')::date AS d1
),
sku_last AS (
  SELECT DISTINCT ON (s.sku_label)
    s.sku_label,
    s.total_available AS last_qty
  FROM shopify_inventory_snapshots s
  WHERE NULLIF(BTRIM(s.sku_label), '') IS NOT NULL
    AND NULLIF(
      regexp_replace(
        regexp_replace(
          regexp_replace(BTRIM(s.sku_label), chr(8212), '', 'g'),
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
  ORDER BY s.sku_label, s.captured_at DESC
),
line_ids_for_title AS (
  SELECT
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
    NULLIF(TRIM(li.title), '') AS title
  FROM shopify_order_line_items li
),
title_by_eff_inv AS (
  SELECT
    eff_inventory_item_id,
    MAX(title) AS title
  FROM line_ids_for_title
  WHERE eff_inventory_item_id IS NOT NULL
    AND title IS NOT NULL
  GROUP BY eff_inventory_item_id
),
inv_one_per_sku AS (
  SELECT DISTINCT ON (BTRIM(il.raw_json->>'inventoryItemSku'))
    BTRIM(il.raw_json->>'inventoryItemSku') AS sku_label,
    il.inventory_item_id
  FROM shopify_inventory_levels il
  WHERE NULLIF(BTRIM(il.raw_json->>'inventoryItemSku'), '') IS NOT NULL
  ORDER BY BTRIM(il.raw_json->>'inventoryItemSku'), il.inventory_item_id
),
title_by_line_sku AS (
  SELECT
    BTRIM(
      COALESCE(
        NULLIF(TRIM(li.sku), ''),
        NULLIF(TRIM(li.raw_json #>> '{variant,sku}'), '')
      )
    ) AS sku_label,
    MAX(NULLIF(TRIM(li.title), '')) AS title
  FROM shopify_order_line_items li
  WHERE NULLIF(
    BTRIM(
      COALESCE(
        NULLIF(TRIM(li.sku), ''),
        NULLIF(TRIM(li.raw_json #>> '{variant,sku}'), '')
      )
    ),
    ''
  ) IS NOT NULL
  GROUP BY 1
),
title_by_match_key AS (
  SELECT
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
    ) AS mk,
    MAX(NULLIF(TRIM(li.title), '')) AS title
  FROM shopify_order_line_items li
  GROUP BY 1
),
sku_with_display AS (
  SELECT
    sl.sku_label,
    sl.last_qty,
    public.shopify_product_display_label(
      sl.sku_label,
      COALESCE(
        NULLIF(TRIM(tbi.title), ''),
        NULLIF(TRIM(tbl.title), ''),
        NULLIF(TRIM(tmk.title), ''),
        sl.sku_label
      )
    ) AS display_label
  FROM sku_last sl
  LEFT JOIN inv_one_per_sku i ON i.sku_label = sl.sku_label
  LEFT JOIN title_by_eff_inv tbi ON tbi.eff_inventory_item_id = i.inventory_item_id
  LEFT JOIN title_by_line_sku tbl ON tbl.sku_label = BTRIM(sl.sku_label)
  LEFT JOIN title_by_match_key tmk ON tmk.mk = translate(
    lower(trim(both FROM BTRIM(sl.sku_label))),
    chr(65339) || chr(65122),
    '++'
  )
),
product_totals AS (
  SELECT
    display_label,
    SUM(last_qty)::numeric AS last_qty
  FROM sku_with_display
  GROUP BY display_label
),
top10 AS (
  SELECT pt.display_label, pt.last_qty
  FROM product_totals pt
  ORDER BY pt.last_qty DESC
  LIMIT 10
),
skus_for_chart AS (
  SELECT swd.sku_label, swd.display_label
  FROM sku_with_display swd
  INNER JOIN top10 t ON t.display_label = swd.display_label
),
daily_last AS (
  SELECT DISTINCT ON (
    (s.captured_at AT TIME ZONE 'Europe/Bratislava')::date,
    s.sku_label
  )
    (s.captured_at AT TIME ZONE 'Europe/Bratislava')::date AS d,
    s.sku_label,
    s.total_available
  FROM shopify_inventory_snapshots s
  INNER JOIN skus_for_chart sc ON sc.sku_label = s.sku_label
  CROSS JOIN bounds b
  WHERE (s.captured_at AT TIME ZONE 'Europe/Bratislava')::date BETWEEN b.chart_d0 AND b.d1
  ORDER BY
    (s.captured_at AT TIME ZONE 'Europe/Bratislava')::date,
    s.sku_label,
    s.captured_at DESC
),
daily_grouped AS (
  SELECT
    dl.d,
    sc.display_label,
    SUM(dl.total_available)::numeric AS total_available
  FROM daily_last dl
  INNER JOIN skus_for_chart sc ON sc.sku_label = dl.sku_label
  GROUP BY dl.d, sc.display_label
)
SELECT json_build_object(
  'year', (SELECT y FROM bounds),
  'from', (SELECT chart_d0 FROM bounds)::text,
  'to', (SELECT d1 FROM bounds)::text,
  'skuOrder',
  COALESCE(
    (SELECT json_agg(t.display_label ORDER BY t.last_qty DESC) FROM top10 t),
    '[]'::json
  ),
  'points',
  COALESCE(
    (
      SELECT json_agg(
        json_build_object(
          'date', dg.d::text,
          'sku', dg.display_label,
          'stock', dg.total_available,
          'product_title', dg.display_label
        )
        ORDER BY dg.d, dg.display_label
      )
      FROM daily_grouped dg
    ),
    '[]'::json
  )
);
$$;

COMMENT ON FUNCTION public.get_shopify_inventory_stock_chart_ytd IS
  'YTD stock chart: top 10 canonical products (shopify_product_display_label); daily stock = sum of SKU aliases';
