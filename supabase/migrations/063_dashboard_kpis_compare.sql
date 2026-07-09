-- KPI-only RPC for period-over-period scorecard comparison.

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
  IF v_kpi_prod IS NOT NULL AND v_kpi_prod NOT IN ('moja_phase_bez', 'moja_phase_plus') THEN
    RAISE EXCEPTION 'invalid p_kpi_product: % (allowed: all, moja_phase_bez, moja_phase_plus)', p_kpi_product;
  END IF;

  SELECT json_build_object(
    'revenue', a.revenue,
    'orders', a.orders,
    'aov', a.aov,
    'currency', a.currency,
    'returning_customers_pct', r.returning_customers_pct,
    'avg_units_per_order',
      CASE
        WHEN a.orders > 0 THEN ROUND(u.total_units / a.orders::numeric, 2)
        ELSE NULL::numeric
      END,
    'pct_orders_multi_sku',
      CASE
        WHEN a.orders > 0 THEN ROUND(100.0 * msku.cnt::numeric / a.orders::numeric, 1)
        ELSE NULL::numeric
      END,
    'avg_customer_ltv', ltv.avg_customer_ltv,
    'avg_units_per_unique_customer',
      CASE
        WHEN uc.cust_cnt > 0 THEN ROUND(uc.units_sum / uc.cust_cnt::numeric, 2)
        ELSE NULL::numeric
      END,
    'avg_days_first_to_second_purchase', fs.avg_days_first_to_second
  )
  INTO v_result
  FROM (
    SELECT
      COALESCE(SUM(ord_ps.product_line_revenue), 0)::numeric AS revenue,
      COUNT(*)::int AS orders,
      CASE
        WHEN COUNT(*) > 0 THEN ROUND((SUM(ord_ps.product_line_revenue) / COUNT(*))::numeric, 2)
        ELSE 0
      END AS aov,
      MAX(ord_ps.currency) AS currency
    FROM (
      SELECT o.id,
             o.currency,
             (
               SELECT COALESCE(SUM(li.quantity * COALESCE(li.unit_price, 0)), 0)::numeric
               FROM shopify_order_line_items li
               WHERE li.order_id = o.id
                 AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title) AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li.sku, li.title, v_kpi_prod))
             ) AS product_line_revenue
      FROM shopify_orders o
      WHERE o.created_at >= p_ts_from
        AND o.created_at < p_ts_to_excl
        AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
          'PAID',
          'PARTIALLY_PAID',
          'PARTIALLY_REFUNDED'
        )
        AND EXISTS (
          SELECT 1
          FROM shopify_order_line_items li_hp
          WHERE li_hp.order_id = o.id
            AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li_hp.sku, li_hp.title)
            AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li_hp.sku, li_hp.title, v_kpi_prod))
        )
    ) ord_ps
  ) a
  CROSS JOIN LATERAL (
    SELECT COALESCE(SUM(li.quantity), 0)::numeric AS total_units
    FROM shopify_order_line_items li
    INNER JOIN shopify_orders o ON o.id = li.order_id
    WHERE o.created_at >= p_ts_from
      AND o.created_at < p_ts_to_excl
      AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
        'PAID',
        'PARTIALLY_PAID',
        'PARTIALLY_REFUNDED'
      )
      AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title) AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li.sku, li.title, v_kpi_prod))
  ) u
  CROSS JOIN LATERAL (
    SELECT COUNT(*)::int AS cnt
    FROM (
      SELECT li.order_id
      FROM shopify_order_line_items li
      INNER JOIN shopify_orders o ON o.id = li.order_id
      WHERE o.created_at >= p_ts_from
        AND o.created_at < p_ts_to_excl
        AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
          'PAID',
          'PARTIALLY_PAID',
          'PARTIALLY_REFUNDED'
        )
        AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title) AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li.sku, li.title, v_kpi_prod))
      GROUP BY li.order_id
      HAVING COUNT(DISTINCT COALESCE(
        NULLIF(TRIM(li.sku), ''),
        NULLIF(TRIM(li.title), ''),
        '—'
      )) > 1
    ) t
  ) msku
  CROSS JOIN LATERAL (
    SELECT
      CASE
        WHEN cw.cnt = 0 THEN NULL::numeric
        ELSE ROUND(100.0 * rw_ytd.cnt / cw.cnt, 1)
      END AS returning_customers_pct
    FROM (
      SELECT COUNT(DISTINCT public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email))::numeric AS cnt
      FROM shopify_orders o
      WHERE o.created_at >= p_ts_from
        AND o.created_at < p_ts_to_excl
        AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
          'PAID',
          'PARTIALLY_PAID',
          'PARTIALLY_REFUNDED'
        )
        AND public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM shopify_order_line_items li_hp
          WHERE li_hp.order_id = o.id
            AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li_hp.sku, li_hp.title)
            AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li_hp.sku, li_hp.title, v_kpi_prod))
        )
    ) cw
    CROSS JOIN LATERAL (
      SELECT COUNT(*)::numeric AS cnt
      FROM (
        SELECT public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) AS gk
        FROM shopify_orders o
        WHERE o.created_at >= p_ts_from
          AND o.created_at < p_ts_to_excl
          AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
            'PAID',
            'PARTIALLY_PAID',
            'PARTIALLY_REFUNDED'
          )
          AND public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) IS NOT NULL
          AND EXISTS (
          SELECT 1
          FROM shopify_order_line_items li_hp
          WHERE li_hp.order_id = o.id
            AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li_hp.sku, li_hp.title)
            AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li_hp.sku, li_hp.title, v_kpi_prod))
        )
        GROUP BY public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email)
        HAVING COUNT(*) >= 2
      ) t
    ) rw_ytd
  ) r
  CROSS JOIN LATERAL (
    SELECT (
      WITH win_gk AS (
        SELECT DISTINCT public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) AS gk
        FROM shopify_orders o
        WHERE o.created_at >= p_ts_from
          AND o.created_at < p_ts_to_excl
          AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
            'PAID',
            'PARTIALLY_PAID',
            'PARTIALLY_REFUNDED'
          )
          AND public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) IS NOT NULL
          AND EXISTS (
          SELECT 1
          FROM shopify_order_line_items li_hp
          WHERE li_hp.order_id = o.id
            AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li_hp.sku, li_hp.title)
            AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li_hp.sku, li_hp.title, v_kpi_prod))
        )
      ),
      ltv_by_gk AS (
        SELECT public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) AS gk,
               SUM(li.quantity * COALESCE(li.unit_price, 0))::numeric AS ltv_sum
        FROM shopify_orders o
        INNER JOIN shopify_order_line_items li ON li.order_id = o.id
        WHERE UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
            'PAID',
            'PARTIALLY_PAID',
            'PARTIALLY_REFUNDED'
          )
          AND public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) IS NOT NULL
          AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title) AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li.sku, li.title, v_kpi_prod))
        GROUP BY 1
      )
      SELECT ROUND(AVG(l.ltv_sum)::numeric, 2)
      FROM win_gk w
      INNER JOIN ltv_by_gk l ON l.gk = w.gk
    ) AS avg_customer_ltv
  ) ltv
  CROSS JOIN LATERAL (
    SELECT
      (
        SELECT COALESCE(SUM(li.quantity), 0)::numeric
        FROM shopify_order_line_items li
        INNER JOIN shopify_orders o ON o.id = li.order_id
        WHERE o.created_at >= p_ts_from
          AND o.created_at < p_ts_to_excl
          AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
            'PAID',
            'PARTIALLY_PAID',
            'PARTIALLY_REFUNDED'
          )
          AND EXISTS (
          SELECT 1
          FROM shopify_order_line_items li_hp
          WHERE li_hp.order_id = o.id
            AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li_hp.sku, li_hp.title)
            AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li_hp.sku, li_hp.title, v_kpi_prod))
        )
          AND public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) IS NOT NULL
          AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title) AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li.sku, li.title, v_kpi_prod))
      ) AS units_sum,
      (
        SELECT COUNT(DISTINCT public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email))::int
        FROM shopify_orders o
        WHERE o.created_at >= p_ts_from
          AND o.created_at < p_ts_to_excl
          AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
            'PAID',
            'PARTIALLY_PAID',
            'PARTIALLY_REFUNDED'
          )
          AND EXISTS (
          SELECT 1
          FROM shopify_order_line_items li_hp
          WHERE li_hp.order_id = o.id
            AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li_hp.sku, li_hp.title)
            AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li_hp.sku, li_hp.title, v_kpi_prod))
        )
          AND public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) IS NOT NULL
      ) AS cust_cnt
  ) uc
  CROSS JOIN LATERAL (
    SELECT ROUND(AVG((p.second_d - p.first_d)::numeric), 1) AS avg_days_first_to_second
    FROM (
      SELECT
        public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) AS gk,
        (array_agg((o.created_at AT TIME ZONE v_tz)::date ORDER BY o.created_at ASC, o.id ASC))[1] AS first_d,
        (array_agg((o.created_at AT TIME ZONE v_tz)::date ORDER BY o.created_at ASC, o.id ASC))[2] AS second_d
      FROM shopify_orders o
      WHERE o.created_at >= p_ts_from
        AND o.created_at < p_ts_to_excl
        AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
          'PAID',
          'PARTIALLY_PAID',
          'PARTIALLY_REFUNDED'
        )
        AND EXISTS (
          SELECT 1
          FROM shopify_order_line_items li_hp
          WHERE li_hp.order_id = o.id
            AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li_hp.sku, li_hp.title)
            AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li_hp.sku, li_hp.title, v_kpi_prod))
        )
        AND public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) IS NOT NULL
      GROUP BY public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email)
      HAVING COUNT(*) >= 2
    ) p
    WHERE p.first_d IS NOT NULL
      AND p.second_d IS NOT NULL
      AND p.second_d >= p.first_d
  ) fs;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.shopify_dashboard_kpis_for_window(timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shopify_dashboard_kpis_for_window(timestamptz, timestamptz, text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_shopify_dashboard_kpis(
  p_from date,
  p_to date,
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
  v_ts_from timestamptz;
  v_ts_to_excl timestamptz;
BEGIN
  v_ts_from := (p_from::timestamp AT TIME ZONE v_tz);
  v_ts_to_excl := ((p_to + 1)::timestamp AT TIME ZONE v_tz);
  RETURN public.shopify_dashboard_kpis_for_window(v_ts_from, v_ts_to_excl, p_kpi_product);
END;
$$;

REVOKE ALL ON FUNCTION public.get_shopify_dashboard_kpis(date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shopify_dashboard_kpis(date, date, text) TO service_role;

COMMENT ON FUNCTION public.get_shopify_dashboard_kpis(date, date, text) IS
  'Paid-ish Shopify KPIs for an arbitrary Bratislava date window (scorecard period compare).';

NOTIFY pgrst, 'reload schema';
