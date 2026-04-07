-- Daily units sold per SKU from Jan 1 (Europe/Bratislava) to today; top 10 SKUs by YTD units.
-- Same paid-ish financial filter as get_shopify_dashboard_mvp.

CREATE OR REPLACE FUNCTION public.get_shopify_sku_units_daily_ytd()
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
      1,
      1
    ) AS d0,
    (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Bratislava')::date AS d1
),
paid_orders AS (
  SELECT o.id, o.created_at
  FROM shopify_orders o
  CROSS JOIN bounds b
  WHERE (o.created_at AT TIME ZONE 'Europe/Bratislava')::date BETWEEN b.d0 AND b.d1
    AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
      'PAID',
      'PARTIALLY_PAID',
      'PARTIALLY_REFUNDED'
    )
),
line_agg AS (
  SELECT
    (po.created_at AT TIME ZONE 'Europe/Bratislava')::date AS d,
    COALESCE(
      NULLIF(TRIM(li.sku), ''),
      NULLIF(TRIM(li.title), ''),
      '—'
    ) AS sku_label,
    SUM(li.quantity)::bigint AS units
  FROM paid_orders po
  INNER JOIN shopify_order_line_items li ON li.order_id = po.id
  GROUP BY 1, 2
),
sku_rank AS (
  SELECT sku_label, SUM(units) AS tot
  FROM line_agg
  GROUP BY 1
  ORDER BY tot DESC
  LIMIT 10
),
filtered AS (
  SELECT la.d, la.sku_label, la.units
  FROM line_agg la
  INNER JOIN sku_rank sr ON sr.sku_label = la.sku_label
)
SELECT json_build_object(
  'year', (SELECT y FROM bounds),
  'from', (SELECT d0 FROM bounds)::text,
  'to', (SELECT d1 FROM bounds)::text,
  'skuOrder',
  COALESCE(
    (SELECT json_agg(sr.sku_label ORDER BY sr.tot DESC) FROM sku_rank sr),
    '[]'::json
  ),
  'points',
  COALESCE(
    (
      SELECT json_agg(
        json_build_object(
          'date', f.d::text,
          'sku', f.sku_label,
          'units', f.units
        )
        ORDER BY f.d, f.sku_label
      )
      FROM filtered f
    ),
    '[]'::json
  )
);
$$;

REVOKE ALL ON FUNCTION public.get_shopify_sku_units_daily_ytd() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shopify_sku_units_daily_ytd() TO service_role;

COMMENT ON FUNCTION public.get_shopify_sku_units_daily_ytd IS 'YTD daily line-item units per top-10 SKU labels (paid-ish orders, Bratislava dates)';
