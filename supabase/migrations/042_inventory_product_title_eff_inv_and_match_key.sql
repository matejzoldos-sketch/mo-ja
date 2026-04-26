-- Sklad: product_title spoľahlivejšie — eff. inventory_item_id z raw_json (ako line_eff)
-- a MAX(title) podľa sku_match_key (Unicode „+“ / variant sku), nie len stĺpec inventory_item_id + BTRIM(sku).

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
top10 AS (
  SELECT sl.sku_label, sl.last_qty
  FROM sku_last sl
  ORDER BY sl.last_qty DESC
  LIMIT 10
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
top10_display AS (
  SELECT
    t.sku_label,
    t.last_qty,
    COALESCE(
      NULLIF(TRIM(tbi.title), ''),
      NULLIF(TRIM(tbl.title), ''),
      NULLIF(TRIM(tmk.title), ''),
      t.sku_label
    ) AS display_label
  FROM top10 t
  LEFT JOIN inv_one_per_sku i ON i.sku_label = t.sku_label
  LEFT JOIN title_by_eff_inv tbi ON tbi.eff_inventory_item_id = i.inventory_item_id
  LEFT JOIN title_by_line_sku tbl ON tbl.sku_label = BTRIM(t.sku_label)
  LEFT JOIN title_by_match_key tmk ON tmk.mk = translate(
    lower(trim(both FROM BTRIM(t.sku_label))),
    chr(65339) || chr(65122),
    '++'
  )
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
  INNER JOIN top10 t ON t.sku_label = s.sku_label
  CROSS JOIN bounds b
  WHERE (s.captured_at AT TIME ZONE 'Europe/Bratislava')::date BETWEEN b.chart_d0 AND b.d1
  ORDER BY
    (s.captured_at AT TIME ZONE 'Europe/Bratislava')::date,
    s.sku_label,
    s.captured_at DESC
)
SELECT json_build_object(
  'year', (SELECT y FROM bounds),
  'from', (SELECT chart_d0 FROM bounds)::text,
  'to', (SELECT d1 FROM bounds)::text,
  'skuOrder',
  COALESCE(
    (SELECT json_agg(t.sku_label ORDER BY t.last_qty DESC) FROM top10 t),
    '[]'::json
  ),
  'points',
  COALESCE(
    (
      SELECT json_agg(
        json_build_object(
          'date', dl.d::text,
          'sku', dl.sku_label,
          'stock', dl.total_available,
          'product_title', td.display_label
        )
        ORDER BY dl.d, dl.sku_label
      )
      FROM daily_last dl
      INNER JOIN top10_display td ON td.sku_label = dl.sku_label
    ),
    '[]'::json
  )
);
$$;

COMMENT ON FUNCTION public.get_shopify_inventory_stock_chart_ytd IS
  'YTD stock chart: points.product_title via eff inventory_item_id from line raw_json, line SKU/variant sku, then sku_match_key (same normalize as inv levels); points.sku stays snapshot key';

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
joined AS (
  SELECT
    inv.*,
    COALESCE(sbi.units_sold, sy.units_sold, 0)::numeric AS units_sold_ytd,
    COALESCE(
      NULLIF(TRIM(t_eff.title), ''),
      NULLIF(TRIM(tbl.title), ''),
      NULLIF(TRIM(tmk.title), ''),
      inv.sku
    ) AS product_title
  FROM inv
  LEFT JOIN sold_by_inv_item sbi ON sbi.inventory_item_id = inv.inventory_item_id
  LEFT JOIN sold_by_sku sy ON sy.sku_match_key = inv.sku_match_key
  LEFT JOIN title_by_eff_inv t_eff ON t_eff.eff_inventory_item_id = inv.inventory_item_id
  LEFT JOIN title_by_line_sku tbl ON tbl.sku_label = inv.sku
  LEFT JOIN title_by_match_key tmk ON tmk.mk = inv.sku_match_key
)
SELECT COALESCE(
  json_agg(
    json_build_object(
      'inventory_item_id', j.inventory_item_id,
      'location_id', j.location_id,
      'location_name', j.location_name,
      'sku', j.sku,
      'product_title', j.product_title,
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
      END,
      'estimated_stockout_date',
      CASE
        WHEN j.available <= 0 THEN to_char(b.d1, 'YYYY-MM-DD')
        WHEN nd.n > 0
          AND j.units_sold_ytd > 0
          AND (j.units_sold_ytd / nd.n) > 0
        THEN to_char(
          b.d1
          + (
            ROUND(
              (j.available::numeric / (j.units_sold_ytd / nd.n))::numeric,
              0
            )
          )::integer,
          'YYYY-MM-DD'
        )
        ELSE NULL
      END
    )
    ORDER BY j.location_name NULLS LAST, j.product_title, j.sku, j.inventory_item_id
  ),
  '[]'::json
)
FROM joined j
CROSS JOIN n_days nd
CROSS JOIN bounds b;
$$;

COMMENT ON FUNCTION public.get_shopify_inventory_dashboard IS
  'Inventory × location + YTD; product_title via eff inventory_item_id from line raw_json, variant sku string, then sku_match_key; estimated_stockout_date YYYY-MM-DD text';
