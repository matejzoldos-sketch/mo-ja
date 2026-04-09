-- Graf skladu: nepoužívať snapshoty s prázdnym SKU (rovnaký placeholder „—“ ako v sync_shopify.py).

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
  WHERE s.sku_label IS DISTINCT FROM '—'
    AND NULLIF(TRIM(s.sku_label), '') IS NOT NULL
  ORDER BY s.sku_label, s.captured_at DESC
),
top10 AS (
  SELECT sl.sku_label, sl.last_qty
  FROM sku_last sl
  ORDER BY sl.last_qty DESC
  LIMIT 10
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
          'stock', dl.total_available
        )
        ORDER BY dl.d, dl.sku_label
      )
      FROM daily_last dl
    ),
    '[]'::json
  )
);
$$;

COMMENT ON FUNCTION public.get_shopify_inventory_stock_chart_ytd IS
  'Daily last snapshot per SKU (top 10 by latest stock), 7 Apr–today Bratislava; sku_label — / empty omitted; forward-filled in UI';
