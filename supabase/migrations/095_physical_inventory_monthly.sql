-- Fyzický sklad Swiss Point z MO-JA report XLS (hárok Sklad_sumár).
-- Shopify sync ostáva pre e-shop; tento zdroj je „ground truth“ od účtovníctva / skladu.

CREATE TABLE IF NOT EXISTS public.physical_inventory_monthly (
  id bigserial PRIMARY KEY,
  month_key text NOT NULL,
  year integer NOT NULL,
  month_num integer NOT NULL CHECK (month_num >= 1 AND month_num <= 12),
  location text NOT NULL DEFAULT 'swiss_point',
  product_key text NOT NULL,
  product_label text NOT NULL,
  stock_in numeric,
  stock_out numeric,
  stock_end numeric NOT NULL,
  shopify_out numeric,
  source_file text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (month_key, location, product_key)
);

CREATE INDEX IF NOT EXISTS physical_inventory_monthly_year_month_idx
  ON public.physical_inventory_monthly (year, month_num);

COMMENT ON TABLE public.physical_inventory_monthly IS
  'Mesačný fyzický sklad (Swiss Point) z XLS Sklad_sumár; stock_end = stav na konci mesiaca.';

ALTER TABLE public.physical_inventory_monthly ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.physical_inventory_monthly FROM PUBLIC;
GRANT SELECT ON TABLE public.physical_inventory_monthly TO service_role;

CREATE OR REPLACE FUNCTION public.get_physical_inventory_dashboard()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest AS (
    SELECT MAX(p.month_key) AS mk
    FROM physical_inventory_monthly p
    WHERE p.location = 'swiss_point'
      AND EXISTS (
        SELECT 1
        FROM physical_inventory_monthly x
        WHERE x.month_key = p.month_key
          AND x.location = 'swiss_point'
          AND (
            COALESCE(x.stock_in, 0) <> 0
            OR COALESCE(x.stock_out, 0) <> 0
            OR COALESCE(x.shopify_out, 0) <> 0
          )
      )
  ),
  rows AS (
    SELECT
      p.month_key,
      p.product_key,
      p.product_label,
      p.stock_end,
      p.stock_in,
      p.stock_out,
      p.shopify_out,
      p.imported_at
    FROM physical_inventory_monthly p
    CROSS JOIN latest l
    WHERE p.month_key = l.mk
      AND p.location = 'swiss_point'
    ORDER BY p.product_key
  ),
  history AS (
    SELECT
      p.month_key,
      p.product_key,
      p.stock_end
    FROM physical_inventory_monthly p
    WHERE p.location = 'swiss_point'
      AND p.year = (SELECT MAX(year) FROM physical_inventory_monthly)
    ORDER BY p.month_key, p.product_key
  )
  SELECT json_build_object(
    'latestMonthKey', (SELECT mk FROM latest),
    'rows', COALESCE((SELECT json_agg(r ORDER BY r.product_key) FROM rows r), '[]'::json),
    'history', COALESCE((SELECT json_agg(h ORDER BY h.month_key, h.product_key) FROM history h), '[]'::json),
    'importedAt', (SELECT MAX(imported_at) FROM physical_inventory_monthly)
  );
$$;

REVOKE ALL ON FUNCTION public.get_physical_inventory_dashboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_physical_inventory_dashboard() TO service_role;

COMMENT ON FUNCTION public.get_physical_inventory_dashboard IS
  'Posledný mesiac fyzického skladu (Swiss Point) z XLS + YTD história stock_end.';

CREATE OR REPLACE FUNCTION public.get_inventory_sales_30d_by_sku()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'sku', s.sku,
        'qty_30d', s.qty_30d,
        'per_day', ROUND((s.qty_30d / 30.0)::numeric, 4)
      )
      ORDER BY s.qty_30d DESC
    ),
    '[]'::json
  )
  FROM (
    SELECT
      BTRIM(li.sku) AS sku,
      SUM(li.quantity)::int AS qty_30d
    FROM shopify_order_line_items li
    INNER JOIN shopify_orders o ON o.id = li.order_id
    WHERE o.created_at >= (CURRENT_DATE - INTERVAL '30 days')
      AND NULLIF(BTRIM(li.sku), '') IS NOT NULL
    GROUP BY BTRIM(li.sku)
  ) s;
$$;

REVOKE ALL ON FUNCTION public.get_inventory_sales_30d_by_sku() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_inventory_sales_30d_by_sku() TO service_role;

COMMENT ON FUNCTION public.get_inventory_sales_30d_by_sku IS
  'Predaj po SKU za posledných 30 kalendárnych dní — pre stockout runway na /sklad.';
