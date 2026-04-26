-- returning_customers_pct for ytd|30d|90d|365d: % of distinct shopify_order_returning_group_key
-- with 2+ paid-ish orders in the same window (removes rw_roll / prior-before-window branch).

CREATE OR REPLACE FUNCTION public.get_shopify_dashboard_mvp(p_range text DEFAULT 'ytd')
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

  SELECT json_build_object(
    'revenue', a.revenue,
    'orders', a.orders,
    'aov', a.aov,
    'currency', a.currency,
    'returning_customers_pct', r.returning_customers_pct
  )
  INTO v_kpis
  FROM (
    SELECT
      COALESCE(SUM(total_price), 0) AS revenue,
      COUNT(*)::int AS orders,
      CASE WHEN COUNT(*) > 0 THEN ROUND((SUM(total_price) / COUNT(*))::numeric, 2) ELSE 0 END AS aov,
      MAX(currency) AS currency
    FROM shopify_orders
    WHERE created_at >= v_ts_from
      AND created_at < v_ts_to_excl
      AND UPPER(REPLACE(TRIM(COALESCE(financial_status, '')), ' ', '_')) IN (
        'PAID',
        'PARTIALLY_PAID',
        'PARTIALLY_REFUNDED'
      )
  ) a
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
        GROUP BY public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email)
        HAVING COUNT(*) >= 2
      ) t
    ) rw_ytd
  ) r;

  WITH days AS (
    SELECT dd::date AS day
    FROM generate_series(v_from, v_to, '1 day'::interval) AS dd
  ),
  agg AS (
    SELECT (o.created_at AT TIME ZONE v_tz)::date AS day,
           COALESCE(SUM(o.total_price), 0)::numeric AS revenue
    FROM shopify_orders o
    WHERE o.created_at >= v_ts_from
      AND o.created_at < v_ts_to_excl
      AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
        'PAID',
        'PARTIALLY_PAID',
        'PARTIALLY_REFUNDED'
      )
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
                 NULLIF(TRIM(li.sku), ''),
                 NULLIF(TRIM(li.title), ''),
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
        ORDER BY t.sort_ts DESC
      )
      FROM (
        SELECT o.id,
               o.name,
               to_char(o.created_at AT TIME ZONE v_tz, 'YYYY-MM-DD HH24:MI') AS created_at_local,
               o.financial_status,
               o.fulfillment_status,
               o.customer_display_name,
               ROUND(COALESCE(o.total_price, 0)::numeric, 2) AS total_price,
               o.currency,
               o.created_at AS sort_ts
        FROM shopify_orders o
        WHERE o.created_at >= v_ts_from
          AND o.created_at < v_ts_to_excl
        ORDER BY o.created_at DESC
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
          COUNT(*)::int AS orders,
          SUM(COALESCE(o.total_price, 0))::numeric AS revenue,
          MAX(o.currency) AS currency
        FROM shopify_orders o
        WHERE o.created_at >= v_ts_from
          AND o.created_at < v_ts_to_excl
          AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
            'PAID',
            'PARTIALLY_PAID',
            'PARTIALLY_REFUNDED'
          )
          AND public.shopify_order_effective_customer_id(o.raw_json, o.customer_id) IS NOT NULL
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
      'to', v_to::text
    ),
    'kpis', v_kpis,
    'dailyRevenue', v_daily,
    'topProducts', v_top,
    'topCustomers', v_top_customers,
    'recentOrders', v_recent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_shopify_dashboard_mvp(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shopify_dashboard_mvp(text) TO service_role;

COMMENT ON FUNCTION public.get_shopify_dashboard_mvp(text) IS 'MVP JSON: returning_customers_pct = all p_range: % with 2+ paid-ish orders in window / distinct keys with 1+; ytd|30d|90d|365d';
