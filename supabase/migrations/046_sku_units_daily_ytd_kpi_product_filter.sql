-- Denné kusy podľa labelu (SKU RPC): voliteľný p_kpi_product — rovnaká logika ako dashboard (045).

DROP FUNCTION IF EXISTS public.get_shopify_sku_units_daily_ytd(text);

CREATE OR REPLACE FUNCTION public.get_shopify_sku_units_daily_ytd(
  p_range text DEFAULT 'ytd',
  p_kpi_product text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz CONSTANT text := 'Europe/Bratislava';
  v_today date;
  v_from date;
  v_to date;
  v_year int;
  v_ts_from timestamptz;
  v_ts_to_excl timestamptz;
  v_norm text;
  v_kpi_prod text;
  v_result json;
BEGIN
  v_norm := lower(trim(COALESCE(p_range, 'ytd')));
  IF v_norm NOT IN ('ytd', '30d', '90d', '365d') THEN
    RAISE EXCEPTION 'invalid p_range: % (allowed: ytd, 30d, 90d, 365d)', p_range;
  END IF;

  v_kpi_prod := lower(nullif(trim(coalesce(p_kpi_product, '')), ''));
  IF v_kpi_prod = '' OR v_kpi_prod = 'all' THEN
    v_kpi_prod := NULL;
  END IF;
  IF v_kpi_prod IS NOT NULL AND v_kpi_prod NOT IN ('moja_phase_bez', 'moja_phase_plus') THEN
    RAISE EXCEPTION 'invalid p_kpi_product: % (allowed: all, moja_phase_bez, moja_phase_plus)', p_kpi_product;
  END IF;

  v_today := (CURRENT_TIMESTAMP AT TIME ZONE v_tz)::date;
  v_to := v_today;

  IF v_norm = 'ytd' THEN
    v_year := EXTRACT(YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE v_tz))::int;
    v_from := make_date(v_year, 1, 1);
  ELSIF v_norm = '30d' THEN
    v_from := v_today - 29;
  ELSIF v_norm = '90d' THEN
    v_from := v_today - 89;
  ELSE
    v_from := v_today - 364;
  END IF;

  v_ts_from := (v_from::timestamp AT TIME ZONE v_tz);
  v_ts_to_excl := ((v_to + 1)::timestamp AT TIME ZONE v_tz);

  WITH paid_orders AS (
    SELECT o.id, o.created_at
    FROM shopify_orders o
    WHERE o.created_at >= v_ts_from
      AND o.created_at < v_ts_to_excl
      AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
        'PAID',
        'PARTIALLY_PAID',
        'PARTIALLY_REFUNDED'
      )
      AND (
        (v_kpi_prod IS NULL AND public.shopify_order_has_product_line(o.id))
        OR (
          v_kpi_prod IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM shopify_order_line_items li_hp
            WHERE li_hp.order_id = o.id
              AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li_hp.sku, li_hp.title)
              AND public.shopify_line_matches_kpi_product_filter(li_hp.sku, li_hp.title, v_kpi_prod)
          )
        )
      )
  ),
  line_agg AS (
    SELECT
      (po.created_at AT TIME ZONE v_tz)::date AS d,
      COALESCE(
        NULLIF(TRIM(li.title), ''),
        NULLIF(TRIM(li.sku), ''),
        '—'
      ) AS sku_label,
      SUM(li.quantity)::bigint AS units
    FROM paid_orders po
    INNER JOIN shopify_order_line_items li ON li.order_id = po.id
    WHERE NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title)
      AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li.sku, li.title, v_kpi_prod))
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
    'year', EXTRACT(YEAR FROM v_from)::int,
    'range', v_norm,
    'from', v_from::text,
    'to', v_to::text,
    'kpi_product', COALESCE(v_kpi_prod, 'all'),
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
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_shopify_sku_units_daily_ytd(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shopify_sku_units_daily_ytd(text, text) TO service_role;

COMMENT ON FUNCTION public.get_shopify_sku_units_daily_ytd(text, text) IS 'Daily units per top-10 labels; paid_orders: has_product_line or KPI-matching line; lines filtered by shopify_line_matches_kpi_product_filter when p_kpi_product set; p_range ytd|30d|90d|365d';

ALTER FUNCTION public.get_shopify_sku_units_daily_ytd(text, text) VOLATILE;
