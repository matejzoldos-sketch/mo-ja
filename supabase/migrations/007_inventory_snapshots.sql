-- Time series of total available qty per SKU label (sum across locations), one row per sync batch.
-- Used for sklad dashboard chart; populated by sync_shopify.py after inventory upsert.

CREATE TABLE IF NOT EXISTS public.shopify_inventory_snapshots (
  id BIGSERIAL PRIMARY KEY,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sku_label TEXT NOT NULL,
  total_available INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shopify_inv_snap_captured
  ON public.shopify_inventory_snapshots (captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_shopify_inv_snap_sku_time
  ON public.shopify_inventory_snapshots (sku_label, captured_at DESC);

COMMENT ON TABLE public.shopify_inventory_snapshots IS 'Append-only stock snapshots per SKU label (sum available); written on each inventory sync';

ALTER TABLE public.shopify_inventory_snapshots ENABLE ROW LEVEL SECURITY;

-- YTD chart: top 10 SKUs by latest total stock; sparse daily points (last reading per calendar day, Bratislava).
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
      1,
      1
    ) AS d0,
    (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Bratislava')::date AS d1
),
sku_last AS (
  SELECT DISTINCT ON (s.sku_label)
    s.sku_label,
    s.total_available AS last_qty
  FROM shopify_inventory_snapshots s
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
  WHERE (s.captured_at AT TIME ZONE 'Europe/Bratislava')::date BETWEEN b.d0 AND b.d1
  ORDER BY
    (s.captured_at AT TIME ZONE 'Europe/Bratislava')::date,
    s.sku_label,
    s.captured_at DESC
)
SELECT json_build_object(
  'year', (SELECT y FROM bounds),
  'from', (SELECT d0 FROM bounds)::text,
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

REVOKE ALL ON FUNCTION public.get_shopify_inventory_stock_chart_ytd() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shopify_inventory_stock_chart_ytd() TO service_role;

COMMENT ON FUNCTION public.get_shopify_inventory_stock_chart_ytd IS 'YTD daily last snapshot per SKU (top 10 by latest stock); Bratislava calendar days';
