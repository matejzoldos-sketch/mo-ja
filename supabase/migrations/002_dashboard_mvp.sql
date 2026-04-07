-- Dashboard MVP: customer display name + RPC returning JSON for Vercel / Next.js API.

ALTER TABLE shopify_orders
  ADD COLUMN IF NOT EXISTS customer_display_name TEXT;

COMMENT ON COLUMN shopify_orders.customer_display_name IS 'From Shopify Order.customer.displayName when available';

-- Aggregates paid-ish orders (adjust list after you inspect real financial_status values).
CREATE OR REPLACE FUNCTION public.get_shopify_dashboard_mvp()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kpis json;
  v_daily json;
  v_top json;
  v_recent json;
BEGIN
  SELECT json_build_object(
    'revenue', COALESCE(SUM(total_price), 0),
    'orders', COUNT(*)::int,
    'aov', CASE WHEN COUNT(*) > 0 THEN ROUND((SUM(total_price) / COUNT(*))::numeric, 2) ELSE 0 END,
    'currency', MAX(currency)
  )
  INTO v_kpis
  FROM shopify_orders
  WHERE (created_at AT TIME ZONE 'Europe/Bratislava')::date >= DATE '2026-01-01'
    AND UPPER(REPLACE(TRIM(COALESCE(financial_status, '')), ' ', '_')) IN (
      'PAID',
      'PARTIALLY_PAID',
      'PARTIALLY_REFUNDED'
    );

  WITH days AS (
    SELECT dd::date AS day
    FROM generate_series(
      DATE '2026-01-01',
      (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Bratislava')::date,
      INTERVAL '1 day'
    ) AS dd
  ),
  agg AS (
    SELECT (o.created_at AT TIME ZONE 'Europe/Bratislava')::date AS day,
           COALESCE(SUM(o.total_price), 0)::numeric AS revenue
    FROM shopify_orders o
    WHERE (o.created_at AT TIME ZONE 'Europe/Bratislava')::date >= DATE '2026-01-01'
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
        WHERE (o.created_at AT TIME ZONE 'Europe/Bratislava')::date >= DATE '2026-01-01'
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
               to_char(o.created_at AT TIME ZONE 'Europe/Bratislava', 'YYYY-MM-DD HH24:MI') AS created_at_local,
               o.financial_status,
               o.fulfillment_status,
               o.customer_display_name,
               ROUND(COALESCE(o.total_price, 0)::numeric, 2) AS total_price,
               o.currency,
               o.created_at AS sort_ts
        FROM shopify_orders o
        ORDER BY o.created_at DESC
        LIMIT 10
      ) t
    ),
    '[]'::json
  )
  INTO v_recent;

  RETURN json_build_object(
    'kpis', v_kpis,
    'dailyRevenue', v_daily,
    'topProducts', v_top,
    'recentOrders', v_recent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_shopify_dashboard_mvp() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shopify_dashboard_mvp() TO service_role;

COMMENT ON FUNCTION public.get_shopify_dashboard_mvp IS 'MVP JSON for MOJA dashboard: KPIs YTD 2026, daily revenue, top 5 products, last 10 orders';
