-- Predaj dashboard: shopify_dashboard_kpis_for_window — jeden prechod dát namiesto
-- desiatok CROSS JOIN LATERAL skenov; LTV len pre zákazníkov v okne (nie celá história).

CREATE OR REPLACE FUNCTION public.shopify_dashboard_kpis_for_window(
  p_ts_from timestamptz,
  p_ts_to_excl timestamptz,
  p_kpi_product text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz CONSTANT text := 'Europe/Bratislava';
  v_kpi_prod text;
  v_result json;
BEGIN
  v_kpi_prod := lower(nullif(trim(coalesce(p_kpi_product, '')), ''));
  IF v_kpi_prod = '' OR v_kpi_prod = 'all' THEN
    v_kpi_prod := NULL;
  END IF;
  IF v_kpi_prod IS NOT NULL AND v_kpi_prod NOT IN ('moja_phase_bez', 'moja_phase_plus', 'listky') THEN
    RAISE EXCEPTION 'invalid p_kpi_product: % (allowed: all, moja_phase_bez, moja_phase_plus, listky)', p_kpi_product;
  END IF;

  WITH win_lines AS (
    SELECT
      o.id AS order_id,
      o.created_at,
      o.currency,
      public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) AS gk,
      li.quantity,
      COALESCE(
        NULLIF(TRIM(li.sku), ''),
        NULLIF(TRIM(li.title), ''),
        '—'
      ) AS sku_label,
      CASE
        WHEN o.total_price IS NOT NULL AND o.total_price <> 0 AND o.total_price_net IS NOT NULL
          THEN ROUND(
            (li.quantity * COALESCE(li.unit_price, 0) * o.total_price_net / o.total_price)::numeric,
            4
          )
        WHEN COALESCE(o.taxes_included, true) AND COALESCE(o.tax_rate, 0) > 0
          THEN ROUND(
            ((li.quantity * COALESCE(li.unit_price, 0)) / (1 + o.tax_rate))::numeric,
            4
          )
        ELSE (li.quantity * COALESCE(li.unit_price, 0))::numeric
      END AS net_revenue
    FROM shopify_orders o
    INNER JOIN shopify_order_line_items li ON li.order_id = o.id
    WHERE o.created_at >= p_ts_from
      AND o.created_at < p_ts_to_excl
      AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
        'PAID',
        'PARTIALLY_PAID',
        'PARTIALLY_REFUNDED'
      )
      AND public.shopify_line_item_included_for_dashboard_filter(li.sku, li.title, v_kpi_prod)
  ),
  win_orders AS (
    SELECT
      order_id,
      MAX(created_at) AS created_at,
      MAX(currency) AS currency,
      MAX(gk) AS gk,
      SUM(net_revenue) AS order_revenue,
      SUM(quantity) AS order_units,
      COUNT(DISTINCT sku_label) AS distinct_skus
    FROM win_lines
    GROUP BY order_id
  ),
  agg AS (
    SELECT
      COALESCE(SUM(order_revenue), 0)::numeric AS revenue,
      COUNT(*)::int AS orders,
      CASE
        WHEN COUNT(*) > 0 THEN ROUND((SUM(order_revenue) / COUNT(*))::numeric, 2)
        ELSE 0
      END AS aov,
      MAX(currency) AS currency,
      COALESCE(SUM(order_units), 0)::numeric AS total_units,
      COUNT(*) FILTER (WHERE distinct_skus > 1)::int AS multi_sku_orders
    FROM win_orders
  ),
  cust_stats AS (
    SELECT
      COUNT(*) FILTER (WHERE order_cnt >= 2)::numeric AS repeat_cnt,
      COUNT(*)::numeric AS cust_cnt
    FROM (
      SELECT gk, COUNT(*)::int AS order_cnt
      FROM win_orders
      WHERE gk IS NOT NULL
      GROUP BY gk
    ) t
  ),
  cust_units AS (
    SELECT
      COALESCE(SUM(quantity), 0)::numeric AS units_sum,
      COUNT(DISTINCT gk)::int AS cust_cnt
    FROM win_lines
    WHERE gk IS NOT NULL
  ),
  cust_in_win AS (
    SELECT DISTINCT gk
    FROM win_orders
    WHERE gk IS NOT NULL
  ),
  ltv AS (
    SELECT ROUND(AVG(ltv_sum)::numeric, 2) AS avg_customer_ltv
    FROM (
      SELECT
        public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) AS gk,
        SUM(
          CASE
            WHEN o.total_price IS NOT NULL AND o.total_price <> 0 AND o.total_price_net IS NOT NULL
              THEN ROUND(
                (li.quantity * COALESCE(li.unit_price, 0) * o.total_price_net / o.total_price)::numeric,
                4
              )
            WHEN COALESCE(o.taxes_included, true) AND COALESCE(o.tax_rate, 0) > 0
              THEN ROUND(
                ((li.quantity * COALESCE(li.unit_price, 0)) / (1 + o.tax_rate))::numeric,
                4
              )
            ELSE (li.quantity * COALESCE(li.unit_price, 0))::numeric
          END
        )::numeric AS ltv_sum
      FROM shopify_orders o
      INNER JOIN shopify_order_line_items li ON li.order_id = o.id
      INNER JOIN cust_in_win c
        ON c.gk = public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email)
      WHERE UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
          'PAID',
          'PARTIALLY_PAID',
          'PARTIALLY_REFUNDED'
        )
        AND public.shopify_line_item_included_for_dashboard_filter(li.sku, li.title, v_kpi_prod)
      GROUP BY 1
    ) x
  ),
  first_second AS (
    SELECT ROUND(AVG((second_d - first_d)::numeric), 1) AS avg_days_first_to_second
    FROM (
      SELECT
        gk,
        (array_agg((created_at AT TIME ZONE v_tz)::date ORDER BY created_at ASC, order_id ASC))[1] AS first_d,
        (array_agg((created_at AT TIME ZONE v_tz)::date ORDER BY created_at ASC, order_id ASC))[2] AS second_d
      FROM win_orders
      WHERE gk IS NOT NULL
      GROUP BY gk
      HAVING COUNT(*) >= 2
    ) p
    WHERE p.first_d IS NOT NULL
      AND p.second_d IS NOT NULL
      AND p.second_d >= p.first_d
  )
  SELECT json_build_object(
    'revenue', a.revenue,
    'orders', a.orders,
    'aov', a.aov,
    'currency', a.currency,
    'returning_customers_pct',
      CASE
        WHEN cs.cust_cnt = 0 THEN NULL::numeric
        ELSE ROUND(100.0 * cs.repeat_cnt / cs.cust_cnt, 1)
      END,
    'avg_units_per_order',
      CASE
        WHEN a.orders > 0 THEN ROUND(a.total_units / a.orders::numeric, 2)
        ELSE NULL::numeric
      END,
    'pct_orders_multi_sku',
      CASE
        WHEN a.orders > 0 THEN ROUND(100.0 * a.multi_sku_orders::numeric / a.orders::numeric, 1)
        ELSE NULL::numeric
      END,
    'avg_customer_ltv', l.avg_customer_ltv,
    'avg_units_per_unique_customer',
      CASE
        WHEN cu.cust_cnt > 0 THEN ROUND(cu.units_sum / cu.cust_cnt::numeric, 2)
        ELSE NULL::numeric
      END,
    'avg_days_first_to_second_purchase', fs.avg_days_first_to_second
  )
  INTO v_result
  FROM agg a
  CROSS JOIN cust_stats cs
  CROSS JOIN cust_units cu
  CROSS JOIN ltv l
  CROSS JOIN first_second fs;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.shopify_dashboard_kpis_for_window(timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shopify_dashboard_kpis_for_window(timestamptz, timestamptz, text) TO service_role;

COMMENT ON FUNCTION public.shopify_dashboard_kpis_for_window(timestamptz, timestamptz, text) IS
  'Paid-ish Shopify KPIs for a Bratislava date window; single-pass scan + LTV scoped to window customers.';

NOTIFY pgrst, 'reload schema';
