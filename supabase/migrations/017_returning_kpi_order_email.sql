-- KPI „vracajúci“ bez read_customers: Order.email (read_orders) + voliteľne customer_id z raw_json / stĺpca.

ALTER TABLE shopify_orders
  ADD COLUMN IF NOT EXISTS customer_email TEXT;

COMMENT ON COLUMN shopify_orders.customer_email IS 'Order email from GraphQL (normalized lowercase); used when customer_id unknown';

CREATE INDEX IF NOT EXISTS idx_shopify_orders_customer_email
  ON shopify_orders (customer_email)
  WHERE customer_email IS NOT NULL;

UPDATE shopify_orders o
SET customer_email = NULLIF(trim(lower(o.raw_json->>'email')), '')
WHERE o.customer_email IS NULL
  AND o.raw_json->>'email' IS NOT NULL;

CREATE OR REPLACE FUNCTION public.shopify_order_returning_group_key(
  p_raw jsonb,
  p_customer_id bigint,
  p_customer_email text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT COALESCE(
    CASE WHEN p_customer_id IS NOT NULL THEN 'i:' || p_customer_id::text END,
    CASE
      WHEN NULLIF(trim(lower(COALESCE(p_customer_email, ''))), '') IS NOT NULL
      THEN 'e:' || trim(lower(p_customer_email))
      ELSE NULL::text
    END,
    CASE
      WHEN p_raw IS NOT NULL
       AND p_raw->'customer' IS NOT NULL
       AND jsonb_typeof(p_raw->'customer') = 'object'
       AND (substring(p_raw->'customer'->>'id' from '/([0-9]+)$')) IS NOT NULL
      THEN 'i:' || (substring(p_raw->'customer'->>'id' from '/([0-9]+)$'))
      ELSE NULL::text
    END,
    CASE
      WHEN NULLIF(trim(lower(COALESCE(p_raw->>'email', ''))), '') IS NOT NULL
      THEN 'e:' || trim(lower(p_raw->>'email'))
      ELSE NULL::text
    END
  );
$$;

COMMENT ON FUNCTION public.shopify_order_returning_group_key(jsonb, bigint, text) IS 'Stable key for returning-customer KPI: i:customerId or e:normalized email (column or raw_json)';

REVOKE ALL ON FUNCTION public.shopify_order_returning_group_key(jsonb, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shopify_order_returning_group_key(jsonb, bigint, text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_shopify_dashboard_mvp(p_range text DEFAULT 'ytd')
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz CONSTANT text := 'Europe/Bratislava';
  v_today date;
  v_from date;
  v_to date;
  v_year int;
  v_kpis json;
  v_daily json;
  v_top json;
  v_recent json;
  v_norm text;
BEGIN
  v_norm := lower(trim(COALESCE(p_range, 'ytd')));
  IF v_norm NOT IN ('ytd', '30d', '90d') THEN
    RAISE EXCEPTION 'invalid p_range: % (allowed: ytd, 30d, 90d)', p_range;
  END IF;

  v_today := (CURRENT_TIMESTAMP AT TIME ZONE v_tz)::date;
  v_to := v_today;

  IF v_norm = 'ytd' THEN
    v_year := EXTRACT(YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE v_tz))::int;
    v_from := make_date(v_year, 1, 1);
  ELSIF v_norm = '30d' THEN
    v_from := v_today - 29;
  ELSE
    v_from := v_today - 89;
  END IF;

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
    WHERE (created_at AT TIME ZONE v_tz)::date BETWEEN v_from AND v_to
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
        ELSE ROUND(100.0 * rw.cnt / cw.cnt, 1)
      END AS returning_customers_pct
    FROM (
      SELECT COUNT(DISTINCT public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email))::numeric AS cnt
      FROM shopify_orders o
      WHERE (o.created_at AT TIME ZONE v_tz)::date BETWEEN v_from AND v_to
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
        SELECT DISTINCT public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) AS gk
        FROM shopify_orders o
        WHERE (o.created_at AT TIME ZONE v_tz)::date BETWEEN v_from AND v_to
          AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
            'PAID',
            'PARTIALLY_PAID',
            'PARTIALLY_REFUNDED'
          )
          AND public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM shopify_orders p
            WHERE public.shopify_order_returning_group_key(p.raw_json, p.customer_id, p.customer_email)
                = public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email)
              AND UPPER(REPLACE(TRIM(COALESCE(p.financial_status, '')), ' ', '_')) IN (
                'PAID',
                'PARTIALLY_PAID',
                'PARTIALLY_REFUNDED'
              )
              AND (p.created_at AT TIME ZONE v_tz)::date < v_from
          )
      ) t
    ) rw
  ) r;

  WITH days AS (
    SELECT dd::date AS day
    FROM generate_series(v_from, v_to, '1 day'::interval) AS dd
  ),
  agg AS (
    SELECT (o.created_at AT TIME ZONE v_tz)::date AS day,
           COALESCE(SUM(o.total_price), 0)::numeric AS revenue
    FROM shopify_orders o
    WHERE (o.created_at AT TIME ZONE v_tz)::date BETWEEN v_from AND v_to
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
        WHERE (o.created_at AT TIME ZONE v_tz)::date BETWEEN v_from AND v_to
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
        WHERE (o.created_at AT TIME ZONE v_tz)::date BETWEEN v_from AND v_to
        ORDER BY o.created_at DESC
        LIMIT 10
      ) t
    ),
    '[]'::json
  )
  INTO v_recent;

  RETURN json_build_object(
    'meta', json_build_object(
      'range', v_norm,
      'from', v_from::text,
      'to', v_to::text
    ),
    'kpis', v_kpis,
    'dailyRevenue', v_daily,
    'topProducts', v_top,
    'recentOrders', v_recent
  );
END;
$$;

COMMENT ON FUNCTION public.get_shopify_dashboard_mvp(text) IS 'MVP JSON for MOJA dashboard: KPIs (+ returning_customers_pct via customer_id or order email), daily revenue, top 5 products, 10 recent orders; p_range ytd|30d|90d (Bratislava dates)';
