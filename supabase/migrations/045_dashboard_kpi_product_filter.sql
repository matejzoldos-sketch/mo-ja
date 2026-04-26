-- KPI produktový filter pre dashboard (MOJA Phase bez / MOJA Phase+ s fytoestrogénmi) + druhý parameter RPC.

CREATE OR REPLACE FUNCTION public.shopify_line_matches_kpi_product_filter(
  p_sku text,
  p_title text,
  p_filter text
)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT
    p_filter IS NULL
    OR (
      p_filter = 'moja_phase_bez'
      AND lower(coalesce(trim(p_title), '') || ' ' || coalesce(trim(p_sku), '')) LIKE '%moja phase%'
      AND lower(coalesce(trim(p_title), '') || ' ' || coalesce(trim(p_sku), '')) LIKE '%bez%fytoestro%'
      AND lower(coalesce(trim(p_title), '') || ' ' || coalesce(trim(p_sku), '')) NOT LIKE '%phase+%'
    )
    OR (
      p_filter = 'moja_phase_plus'
      AND lower(coalesce(trim(p_title), '') || ' ' || coalesce(trim(p_sku), '')) LIKE '%moja phase+%'
      AND lower(coalesce(trim(p_title), '') || ' ' || coalesce(trim(p_sku), '')) LIKE '%fytoestro%'
    );
$$;

REVOKE ALL ON FUNCTION public.shopify_line_matches_kpi_product_filter(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shopify_line_matches_kpi_product_filter(text, text, text) TO service_role;

COMMENT ON FUNCTION public.shopify_line_matches_kpi_product_filter(text, text, text) IS 'Predaj KPI filter: NULL = all; moja_phase_bez / moja_phase_plus podľa title+sku (lower LIKE).';

DROP FUNCTION IF EXISTS public.get_shopify_dashboard_mvp(text);

CREATE OR REPLACE FUNCTION public.get_shopify_dashboard_mvp(p_range text DEFAULT 'ytd', p_kpi_product text DEFAULT NULL)
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
  v_kpis json;
  v_daily json;
  v_top json;
  v_recent json;
  v_top_customers json;
  v_norm text;
  v_kpi_prod text;
BEGIN
  v_norm := lower(trim(COALESCE(p_range, 'ytd')));
  IF v_norm NOT IN ('ytd', '30d', '90d', '365d') THEN
    RAISE EXCEPTION 'invalid p_range: % (allowed: ytd, 30d, 90d, 365d)', p_range;
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
  INTO v_kpis
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
      WHERE o.created_at >= v_ts_from
        AND o.created_at < v_ts_to_excl
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
    WHERE o.created_at >= v_ts_from
      AND o.created_at < v_ts_to_excl
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
      WHERE o.created_at >= v_ts_from
        AND o.created_at < v_ts_to_excl
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
      WHERE o.created_at >= v_ts_from
        AND o.created_at < v_ts_to_excl
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
        WHERE o.created_at >= v_ts_from
          AND o.created_at < v_ts_to_excl
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
        WHERE o.created_at >= v_ts_from
          AND o.created_at < v_ts_to_excl
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
        WHERE o.created_at >= v_ts_from
          AND o.created_at < v_ts_to_excl
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
        WHERE o.created_at >= v_ts_from
          AND o.created_at < v_ts_to_excl
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
      WHERE o.created_at >= v_ts_from
        AND o.created_at < v_ts_to_excl
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
        'PAID',
        'PARTIALLY_PAID',
        'PARTIALLY_REFUNDED'
      )
      AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title) AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li.sku, li.title, v_kpi_prod))
    GROUP BY 1
  )
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'date', days.day::text,
        'revenue', ROUND(COALESCE(agg.revenue, 0)::numeric, 2)
      )
      ORDER BY days.day
    ),
    '[]'::json
  )
  INTO v_daily
  FROM days
  LEFT JOIN agg ON agg.day = days.day;

  SELECT COALESCE(
    (
      SELECT json_agg(
        json_build_object(
          'label', s.label,
          'revenue', ROUND(s.revenue::numeric, 2),
          'units', s.units
        )
        ORDER BY s.revenue DESC
      )
      FROM (
        SELECT COALESCE(
                 NULLIF(TRIM(li.title), ''),
                 NULLIF(TRIM(li.sku), ''),
                 '—'
               ) AS label,
               SUM(li.quantity * COALESCE(li.unit_price, 0))::numeric AS revenue,
               SUM(li.quantity)::int AS units
        FROM shopify_order_line_items li
        INNER JOIN shopify_orders o ON o.id = li.order_id
        WHERE o.created_at >= v_ts_from
          AND o.created_at < v_ts_to_excl
          AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
            'PAID',
            'PARTIALLY_PAID',
            'PARTIALLY_REFUNDED'
          )
          AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title) AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li.sku, li.title, v_kpi_prod))
        GROUP BY 1
        ORDER BY revenue DESC
        LIMIT 5
      ) s
    ),
    '[]'::json
  )
  INTO v_top;

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
          'total_price', t.total_price,
          'currency', t.currency
        )
        ORDER BY
          CASE WHEN v_norm IN ('90d', '365d') THEN t.total_price::numeric END DESC NULLS LAST,
          t.sort_ts DESC
      )
      FROM (
        SELECT o.id,
               o.name,
               to_char(o.created_at AT TIME ZONE v_tz, 'YYYY-MM-DD HH24:MI') AS created_at_local,
               o.financial_status,
               o.fulfillment_status,
               o.customer_display_name,
               ROUND(
                 (
                   SELECT COALESCE(SUM(li.quantity * COALESCE(li.unit_price, 0)), 0)::numeric
                   FROM shopify_order_line_items li
                   WHERE li.order_id = o.id
                     AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title) AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li.sku, li.title, v_kpi_prod))
                 ),
                 2
               ) AS total_price,
               o.currency,
               o.created_at AS sort_ts
        FROM shopify_orders o
        WHERE o.created_at >= v_ts_from
          AND o.created_at < v_ts_to_excl
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
        ORDER BY
          CASE WHEN v_norm IN ('90d', '365d') THEN
            (
              SELECT COALESCE(SUM(li.quantity * COALESCE(li.unit_price, 0)), 0)::numeric
              FROM shopify_order_line_items li
              WHERE li.order_id = o.id
                AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title) AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li.sku, li.title, v_kpi_prod))
            )
          END DESC NULLS LAST,
          o.created_at DESC
        LIMIT 10
      ) t
    ),
    '[]'::json
  )
  INTO v_recent;

  SELECT COALESCE(
    (
      SELECT json_agg(
        json_build_object(
          'customer_id', x.customer_id,
          'orders', x.orders,
          'revenue', ROUND(x.revenue::numeric, 2),
          'currency', x.currency
        )
        ORDER BY x.revenue DESC
      )
      FROM (
        SELECT
          public.shopify_order_effective_customer_id(o.raw_json, o.customer_id) AS customer_id,
          COUNT(DISTINCT o.id)::int AS orders,
          SUM(li.quantity * COALESCE(li.unit_price, 0))::numeric AS revenue,
          MAX(o.currency) AS currency
        FROM shopify_orders o
        INNER JOIN shopify_order_line_items li ON li.order_id = o.id
        WHERE o.created_at >= v_ts_from
          AND o.created_at < v_ts_to_excl
          AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
            'PAID',
            'PARTIALLY_PAID',
            'PARTIALLY_REFUNDED'
          )
          AND public.shopify_order_effective_customer_id(o.raw_json, o.customer_id) IS NOT NULL
          AND EXISTS (
          SELECT 1
          FROM shopify_order_line_items li_hp
          WHERE li_hp.order_id = o.id
            AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li_hp.sku, li_hp.title)
            AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li_hp.sku, li_hp.title, v_kpi_prod))
        )
          AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title) AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li.sku, li.title, v_kpi_prod))
        GROUP BY 1
        ORDER BY revenue DESC
        LIMIT 10
      ) x
    ),
    '[]'::json
  )
  INTO v_top_customers;

  RETURN json_build_object(
    'meta', json_build_object(
      'range', v_norm,
      'from', v_from::text,
      'to', v_to::text,
      'kpi_product', COALESCE(v_kpi_prod, 'all')
    ),
    'kpis', v_kpis,
    'dailyRevenue', v_daily,
    'topProducts', v_top,
    'topCustomers', v_top_customers,
    'recentOrders', v_recent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_shopify_dashboard_mvp(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shopify_dashboard_mvp(text, text) TO service_role;

COMMENT ON FUNCTION public.get_shopify_dashboard_mvp(text, text) IS 'Predaj MVP: optional p_kpi_product moja_phase_bez|moja_phase_plus|NULL=all; avg_days first-second; avg_units per customer; topProducts; returning %; LTV; ytd|30d|90d|365d';

ALTER FUNCTION public.get_shopify_dashboard_mvp(text, text) VOLATILE;
