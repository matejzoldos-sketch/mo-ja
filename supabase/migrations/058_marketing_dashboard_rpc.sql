-- Marketing dashboard: UTM agregácie (source / medium / campaign) + zoznam objednávok.

CREATE OR REPLACE FUNCTION public.shopify_utm_channel_label(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN p_raw IS NULL OR btrim(p_raw) = '' THEN 'Neznámy'
      WHEN lower(btrim(p_raw)) = 'direct' THEN 'Direct'
      WHEN lower(btrim(p_raw)) = 'meta' THEN 'Meta Ads'
      WHEN lower(btrim(p_raw)) IN ('facebook', 'fb') THEN 'Facebook'
      WHEN lower(btrim(p_raw)) IN ('ig', 'instagram') THEN 'Instagram'
      WHEN lower(btrim(p_raw)) = 'google' THEN 'Google'
      WHEN lower(btrim(p_raw)) IN ('newsletter', 'shopify_email', 'email') THEN 'Email'
      WHEN lower(btrim(p_raw)) = 'bing' THEN 'Bing'
      WHEN lower(btrim(p_raw)) LIKE '%mo-ja.com%' OR lower(btrim(p_raw)) LIKE '%mo-ja.sk%' THEN 'Vlastný web'
      WHEN lower(btrim(p_raw)) LIKE '%shopify.com%' THEN 'Shopify'
      WHEN lower(btrim(p_raw)) LIKE 'http%' THEN
        COALESCE(
          NULLIF(
            regexp_replace(lower(btrim(p_raw)), '^https?://([^/?#]+).*$', '\1'),
            ''
          ),
          left(btrim(p_raw), 48)
        )
      ELSE btrim(p_raw)
    END;
$$;

REVOKE ALL ON FUNCTION public.shopify_utm_channel_label(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shopify_utm_channel_label(text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_shopify_marketing_dashboard(p_range text DEFAULT '90d')
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH bounds AS (
  SELECT
    CASE lower(trim(COALESCE(p_range, '90d')))
      WHEN '30d' THEN ((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Bratislava')::date - 29)
      WHEN '90d' THEN ((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Bratislava')::date - 89)
      WHEN '365d' THEN ((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Bratislava')::date - 364)
      ELSE NULL::date
    END AS d_from,
    (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Bratislava')::date AS d_to,
    lower(trim(COALESCE(p_range, '90d'))) AS range_key
),
range_ok AS (
  SELECT *
  FROM bounds b
  WHERE b.range_key IN ('30d', '90d', '365d')
    AND b.d_from IS NOT NULL
),
paid_orders AS (
  SELECT
    o.id,
    o.name,
    o.created_at,
    o.currency,
    o.utm_source,
    o.utm_medium,
    o.utm_campaign,
    o.utm_content,
    o.utm_term,
    o.utm_landing_page,
    o.utm_referrer_url,
    o.utm_attribution_ready,
    (
      SELECT COALESCE(SUM(li.quantity * COALESCE(li.unit_price, 0)), 0)::numeric
      FROM shopify_order_line_items li
      WHERE li.order_id = o.id
        AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title)
    ) AS product_revenue
  FROM shopify_orders o
  CROSS JOIN range_ok r
  WHERE o.created_at >= (r.d_from::timestamp AT TIME ZONE 'Europe/Bratislava')
    AND o.created_at < ((r.d_to + 1)::timestamp AT TIME ZONE 'Europe/Bratislava')
    AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
      'PAID',
      'PARTIALLY_PAID',
      'PARTIALLY_REFUNDED'
    )
    AND public.shopify_order_has_product_line(o.id)
),
base AS (
  SELECT
    po.*,
    public.shopify_utm_channel_label(po.utm_source) AS channel_source,
    COALESCE(NULLIF(btrim(po.utm_medium), ''), '—') AS channel_medium,
    COALESCE(NULLIF(btrim(po.utm_campaign), ''), '—') AS channel_campaign
  FROM paid_orders po
),
totals AS (
  SELECT
    COUNT(*)::int AS orders,
    COALESCE(SUM(product_revenue), 0)::numeric AS revenue,
    COUNT(*) FILTER (
      WHERE utm_source IS NOT NULL
        OR utm_medium IS NOT NULL
        OR utm_campaign IS NOT NULL
    )::int AS orders_with_utm,
    MAX(currency) AS currency
  FROM base
),
agg_source AS (
  SELECT channel_source AS label,
         COUNT(*)::int AS orders,
         SUM(product_revenue)::numeric AS revenue
  FROM base
  GROUP BY 1
  ORDER BY revenue DESC
  LIMIT 15
),
agg_medium AS (
  SELECT channel_medium AS label,
         COUNT(*)::int AS orders,
         SUM(product_revenue)::numeric AS revenue
  FROM base
  GROUP BY 1
  ORDER BY revenue DESC
  LIMIT 15
),
agg_campaign AS (
  SELECT channel_campaign AS label,
         COUNT(*)::int AS orders,
         SUM(product_revenue)::numeric AS revenue
  FROM base
  WHERE channel_campaign <> '—'
  GROUP BY 1
  ORDER BY revenue DESC
  LIMIT 15
)
SELECT
  CASE
    WHEN NOT EXISTS (SELECT 1 FROM range_ok) THEN
      NULL::json
    ELSE
      json_build_object(
        'meta', (
          SELECT json_build_object(
            'range', r.range_key,
            'from', r.d_from::text,
            'to', r.d_to::text
          )
          FROM range_ok r
        ),
        'kpis', (
          SELECT json_build_object(
            'orders', t.orders,
            'orders_with_utm', t.orders_with_utm,
            'orders_without_utm', GREATEST(0, t.orders - t.orders_with_utm),
            'revenue', ROUND(t.revenue::numeric, 2),
            'currency', COALESCE(t.currency, 'EUR'),
            'pct_orders_with_utm',
              CASE
                WHEN t.orders > 0 THEN ROUND(100.0 * t.orders_with_utm / t.orders::numeric, 1)
                ELSE NULL::numeric
              END
          )
          FROM totals t
        ),
        'bySource', COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'label', s.label,
                'orders', s.orders,
                'revenue', ROUND(s.revenue::numeric, 2),
                'pct_orders',
                  CASE
                    WHEN (SELECT orders FROM totals) > 0
                    THEN ROUND(100.0 * s.orders / (SELECT orders FROM totals)::numeric, 1)
                    ELSE 0.0
                  END,
                'pct_revenue',
                  CASE
                    WHEN (SELECT revenue FROM totals) > 0
                    THEN ROUND(100.0 * s.revenue / (SELECT revenue FROM totals)::numeric, 1)
                    ELSE 0.0
                  END
              )
              ORDER BY s.revenue DESC
            )
            FROM agg_source s
          ),
          '[]'::json
        ),
        'byMedium', COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'label', s.label,
                'orders', s.orders,
                'revenue', ROUND(s.revenue::numeric, 2),
                'pct_orders',
                  CASE
                    WHEN (SELECT orders FROM totals) > 0
                    THEN ROUND(100.0 * s.orders / (SELECT orders FROM totals)::numeric, 1)
                    ELSE 0.0
                  END,
                'pct_revenue',
                  CASE
                    WHEN (SELECT revenue FROM totals) > 0
                    THEN ROUND(100.0 * s.revenue / (SELECT revenue FROM totals)::numeric, 1)
                    ELSE 0.0
                  END
              )
              ORDER BY s.revenue DESC
            )
            FROM agg_medium s
          ),
          '[]'::json
        ),
        'byCampaign', COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'label', s.label,
                'orders', s.orders,
                'revenue', ROUND(s.revenue::numeric, 2),
                'pct_orders',
                  CASE
                    WHEN (SELECT orders FROM totals) > 0
                    THEN ROUND(100.0 * s.orders / (SELECT orders FROM totals)::numeric, 1)
                    ELSE 0.0
                  END,
                'pct_revenue',
                  CASE
                    WHEN (SELECT revenue FROM totals) > 0
                    THEN ROUND(100.0 * s.revenue / (SELECT revenue FROM totals)::numeric, 1)
                    ELSE 0.0
                  END
              )
              ORDER BY s.revenue DESC
            )
            FROM agg_campaign s
          ),
          '[]'::json
        ),
        'recentOrders', COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', b.id,
                'name', b.name,
                'created_at', to_char(b.created_at AT TIME ZONE 'Europe/Bratislava', 'YYYY-MM-DD HH24:MI'),
                'revenue', ROUND(b.product_revenue::numeric, 2),
                'currency', b.currency,
                'utm_source', b.utm_source,
                'utm_medium', b.utm_medium,
                'utm_campaign', b.utm_campaign,
                'channel_source', b.channel_source,
                'utm_landing_page', b.utm_landing_page,
                'utm_attribution_ready', b.utm_attribution_ready
              )
              ORDER BY b.product_revenue DESC, b.created_at DESC
            )
            FROM (
              SELECT * FROM base
              ORDER BY product_revenue DESC, created_at DESC
              LIMIT 50
            ) b
          ),
          '[]'::json
        )
      )
  END;
$$;

REVOKE ALL ON FUNCTION public.get_shopify_marketing_dashboard(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shopify_marketing_dashboard(text) TO service_role;

COMMENT ON FUNCTION public.get_shopify_marketing_dashboard(text) IS
  'Marketing UTM dashboard: KPIs, breakdown by source/medium/campaign, top orders; paid product orders; 30d|90d|365d (Bratislava).';
