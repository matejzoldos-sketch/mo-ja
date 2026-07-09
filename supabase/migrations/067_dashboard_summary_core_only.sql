-- Further slim down summary RPC to core first-paint metrics only.

CREATE OR REPLACE FUNCTION public.get_shopify_dashboard_summary(
  p_range text DEFAULT 'ytd',
  p_kpi_product text DEFAULT NULL,
  p_month text DEFAULT NULL,
  p_year text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz CONSTANT text := 'Europe/Bratislava';
  v_from date;
  v_to date;
  v_ts_from timestamptz;
  v_ts_to_excl timestamptz;
  v_kpis json;
  v_daily json;
  v_top json;
  v_recent json;
  v_norm text;
  v_kpi_prod text;
BEGIN
  SELECT b.d_from, b.d_to, b.range_key
  INTO v_from, v_to, v_norm
  FROM public.shopify_dashboard_date_bounds(p_range, p_month, p_year) b;

  v_ts_from := (v_from::timestamp AT TIME ZONE v_tz);
  v_ts_to_excl := ((v_to + 1)::timestamp AT TIME ZONE v_tz);

  v_kpi_prod := lower(nullif(trim(coalesce(p_kpi_product, '')), ''));
  IF v_kpi_prod = '' OR v_kpi_prod = 'all' THEN
    v_kpi_prod := NULL;
  END IF;
  IF v_kpi_prod IS NOT NULL AND v_kpi_prod NOT IN ('moja_phase_bez', 'moja_phase_plus', 'listky') THEN
    RAISE EXCEPTION 'invalid p_kpi_product: % (allowed: all, moja_phase_bez, moja_phase_plus, listky)', p_kpi_product;
  END IF;

  WITH order_rollup AS (
    SELECT
      o.id,
      o.name,
      o.created_at,
      o.financial_status,
      o.fulfillment_status,
      o.customer_display_name,
      o.currency,
      COALESCE(SUM(li.quantity * COALESCE(li.unit_price, 0)), 0)::numeric AS revenue,
      COALESCE(SUM(li.quantity), 0)::numeric AS units
    FROM shopify_orders o
    INNER JOIN shopify_order_line_items li ON li.order_id = o.id
    WHERE o.created_at >= v_ts_from
      AND o.created_at < v_ts_to_excl
      AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
        'PAID', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED'
      )
      AND public.shopify_line_item_included_for_dashboard_filter(li.sku, li.title, v_kpi_prod)
    GROUP BY o.id, o.name, o.created_at, o.financial_status, o.fulfillment_status, o.customer_display_name, o.currency
  )
  SELECT json_build_object(
    'revenue', COALESCE(SUM(orx.revenue), 0)::numeric,
    'orders', COUNT(*)::int,
    'aov', CASE WHEN COUNT(*) > 0 THEN ROUND((SUM(orx.revenue) / COUNT(*))::numeric, 2) ELSE 0 END,
    'currency', MAX(orx.currency),
    'avg_units_per_order', CASE WHEN COUNT(*) > 0 THEN ROUND(SUM(orx.units) / COUNT(*)::numeric, 2) ELSE NULL::numeric END,
    'pct_orders_multi_sku', NULL,
    'returning_customers_pct', NULL,
    'avg_customer_ltv', NULL,
    'avg_units_per_unique_customer', NULL,
    'avg_days_first_to_second_purchase', NULL
  )
  INTO v_kpis
  FROM order_rollup orx;

  WITH days AS (
    SELECT dd::date AS day
    FROM generate_series(v_from, v_to, '1 day'::interval) AS dd
  ),
  agg AS (
    SELECT (o.created_at AT TIME ZONE v_tz)::date AS day,
           COALESCE(SUM(li.quantity * COALESCE(li.unit_price, 0)), 0)::numeric AS revenue
    FROM shopify_order_line_items li
    INNER JOIN shopify_orders o ON o.id = li.order_id
    WHERE o.created_at >= v_ts_from
      AND o.created_at < v_ts_to_excl
      AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
        'PAID', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED'
      )
      AND public.shopify_line_item_included_for_dashboard_filter(li.sku, li.title, v_kpi_prod)
    GROUP BY 1
  )
  SELECT COALESCE(
    json_agg(json_build_object('date', days.day::text, 'revenue', ROUND(COALESCE(agg.revenue, 0)::numeric, 2)) ORDER BY days.day),
    '[]'::json
  )
  INTO v_daily
  FROM days
  LEFT JOIN agg ON agg.day = days.day;

  SELECT COALESCE(
    (
      SELECT json_agg(json_build_object('label', s.label, 'revenue', ROUND(s.revenue::numeric, 2), 'units', s.units) ORDER BY s.revenue DESC)
      FROM (
        SELECT public.shopify_product_display_label(li.sku, li.title) AS label,
               SUM(li.quantity * COALESCE(li.unit_price, 0))::numeric AS revenue,
               SUM(li.quantity)::int AS units
        FROM shopify_order_line_items li
        INNER JOIN shopify_orders o ON o.id = li.order_id
        WHERE o.created_at >= v_ts_from
          AND o.created_at < v_ts_to_excl
          AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
            'PAID', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED'
          )
          AND public.shopify_line_item_included_for_dashboard_filter(li.sku, li.title, v_kpi_prod)
        GROUP BY 1
        ORDER BY revenue DESC
        LIMIT 5
      ) s
    ),
    '[]'::json
  ) INTO v_top;

  WITH order_rollup AS (
    SELECT
      o.id,
      o.name,
      to_char(o.created_at AT TIME ZONE v_tz, 'YYYY-MM-DD HH24:MI') AS created_at_local,
      o.financial_status,
      o.fulfillment_status,
      o.customer_display_name,
      o.currency,
      o.created_at AS sort_ts,
      COALESCE(SUM(li.quantity * COALESCE(li.unit_price, 0)), 0)::numeric AS revenue
    FROM shopify_orders o
    INNER JOIN shopify_order_line_items li ON li.order_id = o.id
    WHERE o.created_at >= v_ts_from
      AND o.created_at < v_ts_to_excl
      AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
        'PAID', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED'
      )
      AND public.shopify_line_item_included_for_dashboard_filter(li.sku, li.title, v_kpi_prod)
    GROUP BY o.id, o.name, o.created_at, o.financial_status, o.fulfillment_status, o.customer_display_name, o.currency
  )
  SELECT COALESCE(
    (
      SELECT json_agg(
        json_build_object(
          'id', t.id,
          'name', t.name,
          'created_at', t.created_at_local,
          'financial_status', t.financial_status,
          'fulfillment_status', t.fulfillment_status,
          'customer_display_name', t.customer_display_name,
          'total_price', ROUND(t.revenue::numeric, 2),
          'currency', t.currency
        )
        ORDER BY CASE WHEN v_norm IN ('30d', '90d', '365d', 'month') THEN t.revenue END DESC NULLS LAST, t.sort_ts DESC
      )
      FROM (
        SELECT *
        FROM order_rollup
        ORDER BY CASE WHEN v_norm IN ('30d', '90d', '365d', 'month') THEN revenue END DESC NULLS LAST, sort_ts DESC
        LIMIT 10
      ) t
    ),
    '[]'::json
  ) INTO v_recent;

  RETURN json_build_object(
    'meta', json_build_object(
      'range', v_norm,
      'from', v_from::text,
      'to', v_to::text,
      'kpi_product', COALESCE(v_kpi_prod, 'all'),
      'month', CASE WHEN v_norm = 'month' THEN to_char(v_from, 'YYYY-MM') ELSE NULL END,
      'year', CASE WHEN v_norm = 'year' THEN to_char(v_from, 'YYYY') ELSE NULL END
    ),
    'kpis', v_kpis,
    'dailyRevenue', v_daily,
    'topProducts', v_top,
    'recentOrders', v_recent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_shopify_dashboard_summary(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shopify_dashboard_summary(text, text, text, text) TO service_role;

COMMENT ON FUNCTION public.get_shopify_dashboard_summary(text, text, text, text) IS
  'Slim first-paint sales dashboard RPC with only core KPIs and charts.';

NOTIFY pgrst, 'reload schema';
