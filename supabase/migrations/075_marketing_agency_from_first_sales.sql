-- Marketing dashboard: ROAS od spustenia prvej sales kampane (bez predpredajného trafficu).

CREATE OR REPLACE FUNCTION public.shopify_marketing_agency_label_from_campaign(p_campaign text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN lower(btrim(COALESCE(p_campaign, ''))) LIKE '%(h)%' THEN '(H)'
      WHEN lower(btrim(COALESCE(p_campaign, ''))) LIKE '%filip%'
        OR btrim(COALESCE(p_campaign, '')) ~ '^[0-9]+$' THEN 'Filip'
      ELSE NULL
    END;
$$;

CREATE OR REPLACE FUNCTION public.shopify_marketing_agency_label_from_meta_campaign(p_campaign_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN lower(btrim(COALESCE(p_campaign_name, ''))) LIKE '%filip%' THEN 'Filip'
      WHEN lower(btrim(COALESCE(p_campaign_name, ''))) LIKE '%(h)%' THEN '(H)'
      ELSE NULL
    END;
$$;

REVOKE ALL ON FUNCTION public.shopify_marketing_agency_label_from_campaign(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shopify_marketing_agency_label_from_meta_campaign(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shopify_marketing_agency_label_from_campaign(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.shopify_marketing_agency_label_from_meta_campaign(text) TO service_role;

CREATE OR REPLACE FUNCTION public.shopify_marketing_is_sales_meta_campaign(p_campaign_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN lower(btrim(COALESCE(p_campaign_name, ''))) LIKE '%sales%' THEN true
      WHEN lower(btrim(COALESCE(p_campaign_name, ''))) LIKE '%konverze%' THEN true
      WHEN lower(btrim(COALESCE(p_campaign_name, ''))) LIKE '%rmkt%' THEN true
      ELSE false
    END;
$$;

REVOKE ALL ON FUNCTION public.shopify_marketing_is_sales_meta_campaign(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shopify_marketing_is_sales_meta_campaign(text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_shopify_marketing_dashboard(
  p_range text DEFAULT '90d',
  p_month text DEFAULT NULL,
  p_year text DEFAULT NULL
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH bounds AS (
  SELECT b.d_from, b.d_to, b.range_key, b.month_key
  FROM public.shopify_dashboard_date_bounds(p_range, p_month, p_year) b
),
range_ok AS (
  SELECT *
  FROM bounds b
  WHERE b.range_key IN ('30d', '90d', '365d', 'month', 'year')
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
),
meta_agency_spend AS (
  SELECT
    public.shopify_marketing_agency_label_from_meta_campaign(m.campaign_name) AS agency_label,
    SUM(COALESCE(m.spend_eur, 0))::numeric AS spend_eur
  FROM public.meta_ads_campaign_daily m
  CROSS JOIN range_ok r
  WHERE m.report_date >= r.d_from
    AND m.report_date <= r.d_to
    AND public.shopify_marketing_agency_label_from_meta_campaign(m.campaign_name) IS NOT NULL
  GROUP BY 1
),
rev_agency AS (
  SELECT
    public.shopify_marketing_agency_label_from_campaign(pc.channel_campaign) AS agency_label,
    COUNT(*)::int AS orders,
    SUM(pc.product_revenue)::numeric AS revenue
  FROM base pc
  WHERE pc.channel_source IN ('Meta Ads', 'Facebook', 'Instagram')
    AND public.shopify_marketing_agency_label_from_campaign(pc.channel_campaign) IS NOT NULL
  GROUP BY 1
),
agg_agency AS (
  SELECT
    COALESCE(ra.agency_label, ms.agency_label) AS label,
    COALESCE(ra.orders, 0)::int AS orders,
    COALESCE(ra.revenue, 0)::numeric AS revenue,
    COALESCE(ms.spend_eur, 0)::numeric AS spend_eur
  FROM rev_agency ra
  FULL OUTER JOIN meta_agency_spend ms
    ON ms.agency_label = ra.agency_label
  WHERE COALESCE(ra.agency_label, ms.agency_label) IN ('Filip', '(H)')
),
today_sk AS (
  SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Bratislava')::date AS d
),
meta_spend_labeled AS (
  SELECT
    m.report_date,
    m.spend_eur,
    m.campaign_name,
    public.shopify_marketing_agency_label_from_meta_campaign(m.campaign_name) AS agency_label
  FROM public.meta_ads_campaign_daily m
  WHERE public.shopify_marketing_agency_label_from_meta_campaign(m.campaign_name) IS NOT NULL
),
agency_spend_bounds AS (
  SELECT
    agency_label,
    MIN(report_date) FILTER (WHERE spend_eur > 0) AS active_from,
    MAX(report_date) FILTER (WHERE spend_eur > 0) AS active_to
  FROM meta_spend_labeled
  GROUP BY agency_label
),
agency_sales_bounds AS (
  SELECT DISTINCT ON (ms.agency_label)
    ms.agency_label,
    ms.report_date AS sales_from,
    ms.campaign_name AS first_sales_campaign
  FROM meta_spend_labeled ms
  WHERE ms.spend_eur > 0
    AND public.shopify_marketing_is_sales_meta_campaign(ms.campaign_name)
  ORDER BY ms.agency_label, ms.report_date, ms.campaign_name
),
all_paid_orders AS (
  SELECT
    o.id,
    o.created_at,
    o.utm_campaign,
    (
      SELECT COALESCE(SUM(li.quantity * COALESCE(li.unit_price, 0)), 0)::numeric
      FROM shopify_order_line_items li
      WHERE li.order_id = o.id
        AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title)
    ) AS product_revenue,
    public.shopify_utm_channel_label(o.utm_source) AS channel_source,
    COALESCE(NULLIF(btrim(o.utm_campaign), ''), '—') AS channel_campaign
  FROM shopify_orders o
  WHERE UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
      'PAID',
      'PARTIALLY_PAID',
      'PARTIALLY_REFUNDED'
    )
    AND public.shopify_order_has_product_line(o.id)
),
all_agency_orders AS (
  SELECT
    apo.id,
    (apo.created_at AT TIME ZONE 'Europe/Bratislava')::date AS order_day,
    apo.product_revenue,
    public.shopify_marketing_agency_label_from_campaign(apo.channel_campaign) AS agency_label
  FROM all_paid_orders apo
  WHERE apo.channel_source IN ('Meta Ads', 'Facebook', 'Instagram')
    AND public.shopify_marketing_agency_label_from_campaign(apo.channel_campaign) IS NOT NULL
),
agency_lifetime AS (
  SELECT
    b.agency_label AS label,
    b.active_from,
    b.active_to,
    COALESCE((
      SELECT SUM(ms.spend_eur)
      FROM meta_spend_labeled ms
      WHERE ms.agency_label = b.agency_label
        AND ms.report_date >= b.active_from
        AND ms.report_date <= b.active_to
    ), 0)::numeric AS spend_eur,
    COALESCE((
      SELECT COUNT(*)::int
      FROM all_agency_orders ao
      WHERE ao.agency_label = b.agency_label
        AND ao.order_day >= b.active_from
        AND ao.order_day <= b.active_to
    ), 0) AS orders,
    COALESCE((
      SELECT SUM(ao.product_revenue)
      FROM all_agency_orders ao
      WHERE ao.agency_label = b.agency_label
        AND ao.order_day >= b.active_from
        AND ao.order_day <= b.active_to
    ), 0)::numeric AS revenue,
    GREATEST(1, (b.active_to - b.active_from) + 1)::int AS days_active
  FROM agency_spend_bounds b
  WHERE b.agency_label IN ('Filip', '(H)')
    AND b.active_from IS NOT NULL
    AND b.active_to IS NOT NULL
),
first_day_windows AS (
  SELECT
    b.agency_label AS label,
    n.days AS first_days,
    b.active_from AS window_from,
    LEAST(b.active_to, b.active_from + (n.days - 1)) AS window_to
  FROM agency_spend_bounds b
  CROSS JOIN (VALUES (30), (35), (60)) AS n(days)
  WHERE b.agency_label IN ('Filip', '(H)')
    AND b.active_from IS NOT NULL
    AND b.active_to IS NOT NULL
),
agency_first_days AS (
  SELECT
    w.label,
    w.first_days,
    w.window_from,
    w.window_to,
    COALESCE((
      SELECT SUM(ms.spend_eur)
      FROM meta_spend_labeled ms
      WHERE ms.agency_label = w.label
        AND ms.report_date >= w.window_from
        AND ms.report_date <= w.window_to
    ), 0)::numeric AS spend_eur,
    COALESCE((
      SELECT COUNT(*)::int
      FROM all_agency_orders ao
      WHERE ao.agency_label = w.label
        AND ao.order_day >= w.window_from
        AND ao.order_day <= w.window_to
    ), 0) AS orders,
    COALESCE((
      SELECT SUM(ao.product_revenue)
      FROM all_agency_orders ao
      WHERE ao.agency_label = w.label
        AND ao.order_day >= w.window_from
        AND ao.order_day <= w.window_to
    ), 0)::numeric AS revenue
  FROM first_day_windows w
),
agency_from_first_sales AS (
  SELECT
    sb.agency_label AS label,
    sb.sales_from AS active_from,
    b.active_to,
    sb.first_sales_campaign,
    COALESCE((
      SELECT SUM(ms.spend_eur)
      FROM meta_spend_labeled ms
      WHERE ms.agency_label = sb.agency_label
        AND ms.report_date >= sb.sales_from
        AND ms.report_date <= b.active_to
    ), 0)::numeric AS spend_eur,
    COALESCE((
      SELECT COUNT(*)::int
      FROM all_agency_orders ao
      WHERE ao.agency_label = sb.agency_label
        AND ao.order_day >= sb.sales_from
        AND ao.order_day <= b.active_to
    ), 0) AS orders,
    COALESCE((
      SELECT SUM(ao.product_revenue)
      FROM all_agency_orders ao
      WHERE ao.agency_label = sb.agency_label
        AND ao.order_day >= sb.sales_from
        AND ao.order_day <= b.active_to
    ), 0)::numeric AS revenue,
    GREATEST(1, (b.active_to - sb.sales_from) + 1)::int AS days_active
  FROM agency_sales_bounds sb
  INNER JOIN agency_spend_bounds b ON b.agency_label = sb.agency_label
  WHERE sb.agency_label IN ('Filip', '(H)')
    AND b.active_to IS NOT NULL
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
            'to', r.d_to::text,
            'month', CASE WHEN r.range_key = 'month' THEN r.month_key ELSE NULL END,
            'year', CASE WHEN r.range_key = 'year' THEN r.month_key ELSE NULL END
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
        'byAgency', COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'label', a.label,
                'orders', a.orders,
                'revenue', ROUND(a.revenue::numeric, 2),
                'spend_eur', ROUND(a.spend_eur::numeric, 2),
                'roas',
                  CASE
                    WHEN a.spend_eur > 0
                    THEN ROUND((a.revenue / a.spend_eur)::numeric, 2)
                    ELSE NULL
                  END,
                'pct_orders',
                  CASE
                    WHEN (SELECT orders FROM totals) > 0
                    THEN ROUND(100.0 * a.orders / (SELECT orders FROM totals)::numeric, 1)
                    ELSE 0.0
                  END,
                'pct_revenue',
                  CASE
                    WHEN (SELECT revenue FROM totals) > 0
                    THEN ROUND(100.0 * a.revenue / (SELECT revenue FROM totals)::numeric, 1)
                    ELSE 0.0
                  END
              )
              ORDER BY a.revenue DESC
            )
            FROM agg_agency a
          ),
          '[]'::json
        ),
        'agencyBenchmark', json_build_object(
          'lifetime', COALESCE(
            (
              SELECT json_agg(
                json_build_object(
                  'label', l.label,
                  'active_from', l.active_from::text,
                  'active_to', l.active_to::text,
                  'days_active', l.days_active,
                  'orders', l.orders,
                  'revenue', ROUND(l.revenue::numeric, 2),
                  'spend_eur', ROUND(l.spend_eur::numeric, 2),
                  'roas',
                    CASE
                      WHEN l.spend_eur > 0
                      THEN ROUND((l.revenue / l.spend_eur)::numeric, 2)
                      ELSE NULL
                    END
                )
                ORDER BY l.active_from
              )
              FROM agency_lifetime l
            ),
            '[]'::json
          ),
          'firstDays', COALESCE(
            (
              SELECT json_agg(
                json_build_object(
                  'first_days', fd.first_days,
                  'label', fd.label,
                  'window_from', fd.window_from::text,
                  'window_to', fd.window_to::text,
                  'orders', fd.orders,
                  'revenue', ROUND(fd.revenue::numeric, 2),
                  'spend_eur', ROUND(fd.spend_eur::numeric, 2),
                  'roas',
                    CASE
                      WHEN fd.spend_eur > 0
                      THEN ROUND((fd.revenue / fd.spend_eur)::numeric, 2)
                      ELSE NULL
                    END
                )
                ORDER BY fd.first_days, fd.label
              )
              FROM agency_first_days fd
            ),
            '[]'::json
          ),
          'fromFirstSales', COALESCE(
            (
              SELECT json_agg(
                json_build_object(
                  'label', s.label,
                  'first_sales_campaign', s.first_sales_campaign,
                  'active_from', s.active_from::text,
                  'active_to', s.active_to::text,
                  'days_active', s.days_active,
                  'orders', s.orders,
                  'revenue', ROUND(s.revenue::numeric, 2),
                  'spend_eur', ROUND(s.spend_eur::numeric, 2),
                  'roas',
                    CASE
                      WHEN s.spend_eur > 0
                      THEN ROUND((s.revenue / s.spend_eur)::numeric, 2)
                      ELSE NULL
                    END
                )
                ORDER BY s.active_from
              )
              FROM agency_from_first_sales s
            ),
            '[]'::json
          )
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

REVOKE ALL ON FUNCTION public.get_shopify_marketing_dashboard(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shopify_marketing_dashboard(text, text, text) TO service_role;

COMMENT ON FUNCTION public.get_shopify_marketing_dashboard(text, text, text) IS
  'Marketing UTM dashboard: KPIs, breakdowns, byAgency, agencyBenchmark (lifetime, first N days, fromFirstSales).';
