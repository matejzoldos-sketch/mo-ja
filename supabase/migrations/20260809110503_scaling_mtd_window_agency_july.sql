-- Scorecards = current calendar month (MTD). Agency override 900 € from 2026-07-01.
-- View-Through badge: last complete month vs prior month (not YTD).

CREATE OR REPLACE FUNCTION public.get_executive_scaling_dashboard()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_tz CONSTANT text := 'Europe/Bratislava';
  v_today date := (timezone(v_tz, now()))::date;
  v_ytd_from date := make_date(EXTRACT(year FROM v_today)::int, 1, 1);
  v_win_to date := v_today;
  v_win_from date := date_trunc('month', v_today::timestamp)::date; -- current month MTD
  v_pno_target CONSTANT numeric := 12.0;
  v_cr_target CONSTANT numeric := 1.8;
  v_roas_target CONSTANT numeric := 2.5;
  -- Temporary override: new agency fixed fee until journal invoices are available.
  -- Set override to NULL to fall back to last journal invoice for all days.
  v_agency_fee_override CONSTANT numeric := 900;
  v_agency_fee_override_from CONSTANT date := DATE '2026-07-01';
  v_result json;
BEGIN
  WITH
  paid_base AS (
    SELECT
      o.id,
      o.created_at,
      o.utm_source,
      o.utm_medium,
      (
        SELECT COALESCE(
          SUM(
            public.shopify_gross_to_net_for_order(
              li.order_id,
              li.quantity * COALESCE(li.unit_price, 0)
            )
          ),
          0
        )::numeric
        FROM shopify_order_line_items li
        WHERE li.order_id = o.id
          AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title)
      ) AS net_revenue
    FROM shopify_orders o
    WHERE o.created_at >= (v_ytd_from::timestamp AT TIME ZONE v_tz)
      AND o.created_at < ((v_win_to + 1)::timestamp AT TIME ZONE v_tz)
      AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
        'PAID', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED'
      )
      AND public.shopify_order_has_product_line(o.id)
  ),
  win_orders AS (
    SELECT *
    FROM paid_base pb
    WHERE pb.created_at >= (v_win_from::timestamp AT TIME ZONE v_tz)
      AND pb.created_at < ((v_win_to + 1)::timestamp AT TIME ZONE v_tz)
  ),
  win_sales AS (
    SELECT
      COALESCE(SUM(net_revenue), 0)::numeric AS net_sales,
      COUNT(*)::int AS orders,
      COALESCE(
        SUM(net_revenue) FILTER (
          WHERE public.shopify_order_is_paid_meta_utm(utm_source, utm_medium)
        ),
        0
      )::numeric AS utm_meta_net_sales,
      COUNT(*) FILTER (
        WHERE public.shopify_order_is_paid_meta_utm(utm_source, utm_medium)
      )::int AS utm_meta_orders
    FROM win_orders
  ),
  win_ads_spend AS (
    SELECT
      COALESCE(SUM(m.spend_eur), 0)::numeric AS meta_spend,
      COALESCE(
        SUM(m.results) FILTER (
          WHERE m.result_indicator = 'actions:offsite_conversion.fb_pixel_purchase'
        ),
        0
      )::numeric AS meta_purchases,
      COALESCE(SUM(m.purchase_value_eur), 0)::numeric AS meta_purchase_value
    FROM meta_ads_campaign_daily m
    WHERE m.report_date >= v_win_from
      AND m.report_date <= v_win_to
  ),
  last_agency_journal AS (
    SELECT
      j.entry_date AS fee_as_of,
      date_trunc('month', j.entry_date)::date AS fee_month,
      j.amount_eur::numeric AS monthly_fee
    FROM accounting_journal_lines j
    WHERE public.is_journal_agency_management_fee(
      j.line_text, j.partner_name, j.company_name, j.debit_account
    )
    ORDER BY j.entry_date DESC, j.amount_eur DESC
    LIMIT 1
  ),
  -- Monthly fee applicable on a given day (override from start date, else last journal fee).
  last_agency AS (
    SELECT
      j.fee_as_of,
      j.fee_month,
      j.monthly_fee AS journal_monthly_fee,
      COALESCE(v_agency_fee_override, j.monthly_fee)::numeric AS display_monthly_fee,
      (v_agency_fee_override IS NOT NULL) AS is_override
    FROM (SELECT 1) AS _
    LEFT JOIN last_agency_journal j ON true
  ),
  -- Alikvot: for each selected day, add monthlyFee / daysInThatMonth.
  win_agency AS (
    SELECT
      COALESCE(
        ROUND(
          SUM(
            (
              CASE
                WHEN v_agency_fee_override IS NOT NULL
                  AND d.d >= v_agency_fee_override_from
                  THEN v_agency_fee_override
                WHEN v_agency_fee_override IS NOT NULL
                  THEN 0::numeric -- new-agency override: no fee before start date
                ELSE COALESCE(la.journal_monthly_fee, 0)
              END
            )
            / NULLIF(
              EXTRACT(
                day FROM (
                  date_trunc('month', d.d::timestamp)
                  + interval '1 month'
                  - interval '1 day'
                )
              )::numeric,
              0
            )
          ),
          2
        ),
        0
      )::numeric AS agency_fee_14d,
      MAX(COALESCE(la.display_monthly_fee, 0))::numeric AS agency_fee_monthly,
      MAX(
        CASE
          WHEN v_agency_fee_override IS NOT NULL THEN v_agency_fee_override_from
          ELSE la.fee_as_of
        END
      ) AS agency_fee_as_of,
      COALESCE(BOOL_OR(la.is_override), false) AS agency_fee_is_override
    FROM generate_series(v_win_from, v_win_to, interval '1 day') AS d(d)
    CROSS JOIN last_agency la
  ),
  win_sessions AS (
    SELECT
      COALESCE(SUM(s.sessions), 0)::bigint AS sessions,
      COUNT(*)::int AS days_with_sessions
    FROM shopify_sessions_daily s
    WHERE s.report_date >= v_win_from
      AND s.report_date <= v_win_to
  ),
  decision AS (
    SELECT
      ws.net_sales,
      ws.orders,
      ws.utm_meta_net_sales,
      ws.utm_meta_orders,
      wa.meta_spend,
      wa.meta_purchases,
      wa.meta_purchase_value,
      wag.agency_fee_14d,
      wag.agency_fee_monthly,
      wag.agency_fee_as_of,
      wag.agency_fee_is_override,
      (wa.meta_spend + wag.agency_fee_14d)::numeric AS total_spend,
      CASE
        WHEN ws.net_sales > 0
          THEN ROUND(100.0 * (wa.meta_spend + wag.agency_fee_14d) / ws.net_sales, 2)
        ELSE NULL
      END AS blended_pno_pct,
      sess.sessions,
      sess.days_with_sessions,
      CASE
        WHEN sess.sessions > 0
          THEN ROUND(100.0 * ws.orders::numeric / sess.sessions::numeric, 2)
        ELSE NULL
      END AS store_cr_pct,
      CASE
        WHEN wa.meta_spend > 0
          THEN ROUND(ws.utm_meta_net_sales / wa.meta_spend, 2)
        ELSE NULL
      END AS utm_real_roas,
      CASE
        WHEN wa.meta_purchase_value > 0 THEN ROUND(wa.meta_purchase_value, 2)
        WHEN ws.orders > 0 AND wa.meta_purchases > 0
          THEN ROUND(wa.meta_purchases * (ws.net_sales / ws.orders), 2)
        ELSE NULL
      END AS meta_reported_sales,
      CASE
        WHEN wa.meta_spend > 0 AND wa.meta_purchase_value > 0
          THEN ROUND(wa.meta_purchase_value / wa.meta_spend, 2)
        WHEN wa.meta_spend > 0 AND ws.orders > 0 AND wa.meta_purchases > 0
          THEN ROUND(
            (wa.meta_purchases * (ws.net_sales / ws.orders)) / wa.meta_spend,
            2
          )
        ELSE NULL
      END AS meta_reported_roas,
      (wa.meta_purchase_value > 0) AS meta_roas_is_actual
    FROM win_sales ws
    CROSS JOIN win_ads_spend wa
    CROSS JOIN win_agency wag
    CROSS JOIN win_sessions sess
  ),
  decision_status AS (
    SELECT
      d.*,
      CASE
        WHEN d.blended_pno_pct IS NULL THEN 'unknown'
        WHEN d.blended_pno_pct <= v_pno_target THEN 'ok'
        ELSE 'warn'
      END AS biznis_status,
      CASE
        WHEN d.store_cr_pct IS NULL THEN 'unknown'
        WHEN d.store_cr_pct >= v_cr_target THEN 'ok'
        ELSE 'warn'
      END AS trh_status,
      CASE
        WHEN d.utm_real_roas IS NULL THEN 'unknown'
        WHEN d.utm_real_roas >= v_roas_target THEN 'ok'
        ELSE 'warn'
      END AS meta_status
    FROM decision d
  ),
  verdict AS (
    SELECT
      ds.*,
      CASE
        WHEN ds.biznis_status = 'ok'
          AND ds.trh_status = 'ok'
          AND ds.meta_status = 'ok'
          THEN 'increase'
        ELSE 'hold'
      END AS verdict_action,
      ARRAY_REMOVE(
        ARRAY[
          CASE
            WHEN ds.biznis_status = 'warn' THEN
              'Blended PNO ' || ROUND(ds.blended_pno_pct, 2)::text || '% > target '
              || v_pno_target::text || '%'
            WHEN ds.biznis_status = 'unknown' THEN
              'Blended PNO nedostupné (chýbajú net sales alebo spend)'
            ELSE NULL
          END,
          CASE
            WHEN ds.trh_status = 'warn' THEN
              'Store CR ' || ROUND(ds.store_cr_pct, 2)::text || '% < target '
              || v_cr_target::text || '%'
            WHEN ds.trh_status = 'unknown' THEN
              'Store CR nedostupné — chýbajú Shopify sessions (read_reports / ShopifyQL sync)'
            ELSE NULL
          END,
          CASE
            WHEN ds.meta_status = 'warn' THEN
              'UTM Real ROAS ' || ROUND(ds.utm_real_roas, 2)::text || '× < target '
              || v_roas_target::text || '×'
            WHEN ds.meta_status = 'unknown' THEN
              'UTM Real ROAS nedostupné (chýba Meta spend alebo UTM sales)'
            ELSE NULL
          END
        ],
        NULL
      ) AS fail_reasons
    FROM decision_status ds
  ),
  months AS (
    SELECT
      to_char(d, 'YYYY-MM') AS month_key,
      d::date AS month_start,
      (d + interval '1 month - 1 day')::date AS month_end
    FROM generate_series(
      date_trunc('month', v_ytd_from::timestamp),
      date_trunc('month', v_win_to::timestamp),
      interval '1 month'
    ) AS d
  ),
  monthly_sales AS (
    SELECT
      to_char((pb.created_at AT TIME ZONE v_tz)::date, 'YYYY-MM') AS month_key,
      ROUND(SUM(pb.net_revenue), 2) AS net_sales,
      COUNT(*)::int AS orders,
      ROUND(
        SUM(pb.net_revenue) FILTER (
          WHERE public.shopify_order_is_paid_meta_utm(pb.utm_source, pb.utm_medium)
        ),
        2
      ) AS utm_meta_net_sales
    FROM paid_base pb
    GROUP BY 1
  ),
  monthly_ads AS (
    SELECT
      to_char(x.report_date, 'YYYY-MM') AS month_key,
      ROUND(SUM(x.spend_eur), 2) AS meta_spend,
      ROUND(SUM(x.purchases), 2) AS meta_purchases,
      ROUND(SUM(x.purchase_value), 2) AS meta_purchase_value,
      ROUND(SUM(x.purchase_value_7d_click), 2) AS meta_click_value_raw,
      ROUND(SUM(x.purchase_value_1d_view), 2) AS meta_view_value_raw
    FROM (
      SELECT
        report_date,
        campaign_name,
        MAX(spend_eur) AS spend_eur,
        MAX(COALESCE(purchase_value_eur, 0)) AS purchase_value,
        MAX(COALESCE(purchase_value_7d_click_eur, 0)) AS purchase_value_7d_click,
        MAX(COALESCE(purchase_value_1d_view_eur, 0)) AS purchase_value_1d_view,
        SUM(
          CASE
            WHEN result_indicator = 'actions:offsite_conversion.fb_pixel_purchase'
              THEN COALESCE(results, 0)
            ELSE 0
          END
        ) AS purchases
      FROM meta_ads_campaign_daily
      WHERE report_date >= v_ytd_from
        AND report_date <= v_win_to
      GROUP BY report_date, campaign_name
    ) x
    GROUP BY 1
  ),
  monthly_agency_raw AS (
    SELECT
      to_char(j.entry_date, 'YYYY-MM') AS month_key,
      ROUND(COALESCE(SUM(j.amount_eur), 0), 2) AS agency_fee
    FROM accounting_journal_lines j
    WHERE j.entry_date >= v_ytd_from
      AND j.entry_date <= v_win_to
      AND public.is_journal_agency_management_fee(
        j.line_text, j.partner_name, j.company_name, j.debit_account
      )
    GROUP BY 1
  ),
  -- YTD months: override from Jul 2026 (prorate incomplete current month);
  -- earlier months: journal invoice or forward-fill last journal fee.
  monthly_agency AS (
    SELECT
      m.month_key,
      CASE
        WHEN v_agency_fee_override IS NOT NULL
          AND m.month_start >= date_trunc('month', v_agency_fee_override_from::timestamp)::date
          THEN ROUND(
            v_agency_fee_override
              * (
                CASE
                  WHEN m.month_start = date_trunc('month', v_win_to::timestamp)::date
                    THEN EXTRACT(day FROM v_win_to)::numeric
                  ELSE EXTRACT(
                    day FROM (
                      m.month_start::timestamp + interval '1 month' - interval '1 day'
                    )
                  )::numeric
                END
              )
              / NULLIF(
                EXTRACT(
                  day FROM (
                    m.month_start::timestamp + interval '1 month' - interval '1 day'
                  )
                )::numeric,
                0
              ),
            2
          )
        WHEN COALESCE(raw.agency_fee, 0) > 0 THEN raw.agency_fee
        WHEN la.journal_monthly_fee IS NOT NULL
          AND m.month_start >= la.fee_month
          THEN ROUND(la.journal_monthly_fee, 2)
        ELSE 0::numeric
      END AS agency_fee
    FROM months m
    LEFT JOIN monthly_agency_raw raw ON raw.month_key = m.month_key
    LEFT JOIN last_agency la ON true
  ),
  monthly_sessions AS (
    SELECT
      to_char(s.report_date, 'YYYY-MM') AS month_key,
      SUM(s.sessions)::bigint AS sessions
    FROM shopify_sessions_daily s
    WHERE s.report_date >= v_ytd_from
      AND s.report_date <= v_win_to
    GROUP BY 1
  ),
  monthly AS (
    SELECT
      m.month_key,
      m.month_start,
      COALESCE(ms.net_sales, 0)::numeric AS net_sales,
      COALESCE(ms.orders, 0)::int AS orders,
      CASE
        WHEN COALESCE(ms.orders, 0) > 0
          THEN ROUND(ms.net_sales / ms.orders, 2)
        ELSE NULL
      END AS aov,
      COALESCE(ma.meta_spend, 0)::numeric AS meta_spend,
      COALESCE(mag.agency_fee, 0)::numeric AS agency_fee,
      (COALESCE(ma.meta_spend, 0) + COALESCE(mag.agency_fee, 0))::numeric AS total_spend,
      CASE
        WHEN COALESCE(ms.net_sales, 0) > 0
          THEN ROUND(
            100.0 * (COALESCE(ma.meta_spend, 0) + COALESCE(mag.agency_fee, 0)) / ms.net_sales,
            2
          )
        ELSE NULL
      END AS blended_pno_pct,
      COALESCE(mss.sessions, 0)::bigint AS sessions,
      CASE
        WHEN COALESCE(mss.sessions, 0) > 0
          THEN ROUND(100.0 * COALESCE(ms.orders, 0)::numeric / mss.sessions::numeric, 2)
        ELSE NULL
      END AS store_cr_pct,
      COALESCE(ms.utm_meta_net_sales, 0)::numeric AS utm_meta_net_sales,
      CASE
        WHEN COALESCE(ma.meta_spend, 0) > 0
          THEN ROUND(COALESCE(ms.utm_meta_net_sales, 0) / ma.meta_spend, 2)
        ELSE NULL
      END AS utm_real_roas,
      COALESCE(ma.meta_purchases, 0)::numeric AS meta_purchases,
      COALESCE(ma.meta_purchase_value, 0)::numeric AS meta_purchase_value,
      CASE
        WHEN COALESCE(ma.meta_purchase_value, 0) > 0
          THEN ROUND(ma.meta_purchase_value, 2)
        WHEN COALESCE(ms.orders, 0) > 0 AND COALESCE(ma.meta_purchases, 0) > 0
          THEN ROUND(ma.meta_purchases * (ms.net_sales / ms.orders), 2)
        ELSE NULL
      END AS meta_reported_sales,
      CASE
        WHEN COALESCE(ma.meta_spend, 0) > 0
          AND COALESCE(ma.meta_purchase_value, 0) > 0
          THEN ROUND(ma.meta_purchase_value / ma.meta_spend, 2)
        WHEN COALESCE(ma.meta_spend, 0) > 0
          AND COALESCE(ms.orders, 0) > 0
          AND COALESCE(ma.meta_purchases, 0) > 0
          THEN ROUND(
            (ma.meta_purchases * (ms.net_sales / ms.orders)) / ma.meta_spend,
            2
          )
        ELSE NULL
      END AS meta_reported_roas,
      (COALESCE(ma.meta_purchase_value, 0) > 0) AS meta_roas_is_actual,
      -- Attribution split: prefer Meta window columns; else proxy Meta total vs Shopify UTM.
      CASE
        WHEN COALESCE(ma.meta_click_value_raw, 0) > 0
          OR COALESCE(ma.meta_view_value_raw, 0) > 0
          THEN ROUND(COALESCE(ma.meta_click_value_raw, 0), 2)
        WHEN COALESCE(ma.meta_purchase_value, 0) > 0
          THEN ROUND(
            LEAST(
              COALESCE(ma.meta_purchase_value, 0),
              COALESCE(ms.utm_meta_net_sales, 0)
            ),
            2
          )
        ELSE 0::numeric
      END AS meta_click_sales,
      CASE
        WHEN COALESCE(ma.meta_click_value_raw, 0) > 0
          OR COALESCE(ma.meta_view_value_raw, 0) > 0
          THEN ROUND(COALESCE(ma.meta_view_value_raw, 0), 2)
        WHEN COALESCE(ma.meta_purchase_value, 0) > 0
          THEN ROUND(
            GREATEST(
              COALESCE(ma.meta_purchase_value, 0) - COALESCE(ms.utm_meta_net_sales, 0),
              0
            ),
            2
          )
        ELSE 0::numeric
      END AS meta_view_sales,
      NOT (
        COALESCE(ma.meta_click_value_raw, 0) > 0
        OR COALESCE(ma.meta_view_value_raw, 0) > 0
      ) AS attribution_split_is_proxy,
      CASE
        WHEN COALESCE(ms.utm_meta_net_sales, 0) > 0
          AND COALESCE(ma.meta_purchase_value, 0) > 0
          THEN ROUND(ma.meta_purchase_value / NULLIF(ms.utm_meta_net_sales, 0), 2)
        WHEN COALESCE(ms.utm_meta_net_sales, 0) > 0
          AND COALESCE(ms.orders, 0) > 0
          AND COALESCE(ma.meta_purchases, 0) > 0
          THEN ROUND(
            (ma.meta_purchases * (ms.net_sales / ms.orders))
              / NULLIF(ms.utm_meta_net_sales, 0),
            2
          )
        ELSE NULL
      END AS meta_inflation_ratio
    FROM months m
    LEFT JOIN monthly_sales ms ON ms.month_key = m.month_key
    LEFT JOIN monthly_ads ma ON ma.month_key = m.month_key
    LEFT JOIN monthly_agency mag ON mag.month_key = m.month_key
    LEFT JOIN monthly_sessions mss ON mss.month_key = m.month_key
  ),
  attribution_ytd AS (
    SELECT
      ROUND(COALESCE(SUM(m.meta_click_sales), 0), 2) AS meta_click_sales,
      ROUND(COALESCE(SUM(m.meta_view_sales), 0), 2) AS meta_view_sales,
      ROUND(
        COALESCE(SUM(m.meta_click_sales), 0) + COALESCE(SUM(m.meta_view_sales), 0),
        2
      ) AS meta_reported_sales_split,
      ROUND(COALESCE(SUM(m.utm_meta_net_sales), 0), 2) AS shopify_utm_net_sales,
      BOOL_OR(m.attribution_split_is_proxy) AS attribution_split_is_proxy
    FROM monthly m
  ),
  attribution_month_pct AS (
    SELECT
      m.month_key,
      m.month_start,
      CASE
        WHEN (COALESCE(m.meta_click_sales, 0) + COALESCE(m.meta_view_sales, 0)) > 0
          THEN ROUND(
            100.0 * COALESCE(m.meta_view_sales, 0)
              / (COALESCE(m.meta_click_sales, 0) + COALESCE(m.meta_view_sales, 0)),
            1
          )
        ELSE NULL
      END AS view_through_ratio_pct,
      COALESCE(m.meta_click_sales, 0)::numeric AS meta_click_sales,
      COALESCE(m.meta_view_sales, 0)::numeric AS meta_view_sales,
      m.attribution_split_is_proxy
    FROM monthly m
  ),
  -- Last complete calendar month (e.g. July when today is in August).
  attribution_focus AS (
    SELECT *
    FROM attribution_month_pct
    WHERE month_start = (date_trunc('month', v_today::timestamp) - interval '1 month')::date
  ),
  attribution_prev AS (
    SELECT *
    FROM attribution_month_pct
    WHERE month_start = (date_trunc('month', v_today::timestamp) - interval '2 month')::date
  ),
  attribution_card AS (
    SELECT
      y.meta_click_sales,
      y.meta_view_sales,
      y.meta_reported_sales_split,
      y.shopify_utm_net_sales,
      y.attribution_split_is_proxy,
      f.month_key AS focus_month,
      p.month_key AS prev_month,
      f.view_through_ratio_pct AS view_through_ratio_pct,
      p.view_through_ratio_pct AS view_through_ratio_prev_pct,
      CASE EXTRACT(month FROM f.month_start)
        WHEN 1 THEN 'Jan' WHEN 2 THEN 'Feb' WHEN 3 THEN 'Mar' WHEN 4 THEN 'Apr'
        WHEN 5 THEN 'Máj' WHEN 6 THEN 'Jún' WHEN 7 THEN 'Júl' WHEN 8 THEN 'Aug'
        WHEN 9 THEN 'Sep' WHEN 10 THEN 'Okt' WHEN 11 THEN 'Nov' WHEN 12 THEN 'Dec'
      END AS focus_month_label,
      CASE EXTRACT(month FROM p.month_start)
        WHEN 1 THEN 'Jan' WHEN 2 THEN 'Feb' WHEN 3 THEN 'Mar' WHEN 4 THEN 'Apr'
        WHEN 5 THEN 'Máj' WHEN 6 THEN 'Jún' WHEN 7 THEN 'Júl' WHEN 8 THEN 'Aug'
        WHEN 9 THEN 'Sep' WHEN 10 THEN 'Okt' WHEN 11 THEN 'Nov' WHEN 12 THEN 'Dec'
      END AS prev_month_label,
      (
        f.view_through_ratio_pct IS NOT NULL
        AND p.view_through_ratio_pct IS NOT NULL
        AND f.view_through_ratio_pct > p.view_through_ratio_pct
      ) AS view_through_rising,
      (
        COALESCE(f.view_through_ratio_pct, 0) > 40
        OR (
          f.view_through_ratio_pct IS NOT NULL
          AND p.view_through_ratio_pct IS NOT NULL
          AND f.view_through_ratio_pct > p.view_through_ratio_pct
        )
      ) AS view_through_warn
    FROM attribution_ytd y
    LEFT JOIN attribution_focus f ON true
    LEFT JOIN attribution_prev p ON true
  )
  SELECT json_build_object(
    'meta', json_build_object(
      'timezone', v_tz,
      'window_from', v_win_from::text,
      'window_to', v_win_to::text,
      'window_days', (v_win_to - v_win_from + 1),
      'window_label', 'aktuálny mesiac (MTD)',
      'ytd_from', v_ytd_from::text,
      'as_of', v_today::text,
      'agency_fee_monthly', (
        SELECT ROUND(COALESCE(agency_fee_monthly, 0), 2) FROM win_agency
      ),
      'agency_fee_as_of', (
        SELECT agency_fee_as_of::text FROM win_agency
      ),
      'agency_fee_is_override', (
        SELECT agency_fee_is_override FROM win_agency
      ),
      'targets', json_build_object(
        'blended_pno_pct_max', v_pno_target,
        'store_cr_pct_min', v_cr_target,
        'utm_real_roas_min', v_roas_target
      ),
      'attribution', (
        SELECT json_build_object(
          'meta_click_sales', a.meta_click_sales,
          'meta_view_sales', a.meta_view_sales,
          'meta_reported_sales_split', a.meta_reported_sales_split,
          'shopify_utm_net_sales', a.shopify_utm_net_sales,
          'view_through_ratio_pct', a.view_through_ratio_pct,
          'view_through_ratio_prev_pct', a.view_through_ratio_prev_pct,
          'focus_month', a.focus_month,
          'prev_month', a.prev_month,
          'focus_month_label', a.focus_month_label,
          'prev_month_label', a.prev_month_label,
          'view_through_rising', a.view_through_rising,
          'view_through_warn', a.view_through_warn,
          'attribution_split_is_proxy', a.attribution_split_is_proxy,
          'headline',
            CASE
              WHEN a.view_through_ratio_pct IS NULL THEN NULL
              WHEN a.view_through_ratio_prev_pct IS NOT NULL
                AND a.focus_month_label IS NOT NULL
                AND a.prev_month_label IS NOT NULL
                THEN
                  'Meta View-Through Ratio: '
                  || TRIM(TO_CHAR(a.view_through_ratio_pct, '990.0'))
                  || ' % (' || a.focus_month_label || ') vs '
                  || TRIM(TO_CHAR(a.view_through_ratio_prev_pct, '990.0'))
                  || ' % (' || a.prev_month_label || ')'
                  || CASE
                    WHEN a.view_through_rising THEN ' ⚠️ Nadhodnotenie stúpa'
                    ELSE ''
                  END
              ELSE
                'Meta View-Through Ratio: '
                || TRIM(TO_CHAR(a.view_through_ratio_pct, '990.0'))
                || ' %'
                || COALESCE(' (' || a.focus_month_label || ')', '')
            END,
          'warn_message',
            CASE
              WHEN a.view_through_rising
                AND NOT a.attribution_split_is_proxy THEN
                'Nadhodnotenie stúpa — vyšší podiel View-Through oproti predchádzajúcemu mesiacu.'
              WHEN COALESCE(a.view_through_ratio_pct, 0) > 40
                AND a.attribution_split_is_proxy THEN
                'WARNING: Meta vykazuje o viac ako 40 % vyššie tržby než Shopify UTM. Časť Meta reportu pravdepodobne nie je last-touch / click atribúcia.'
              WHEN COALESCE(a.view_through_ratio_pct, 0) > 40 THEN
                'WARNING: Meta vykazuje viac ako 40 % tržieb len zo zobrazení (View-Through). Vysoké riziko parazitovania na organickom dopyte.'
              ELSE NULL
            END
        )
        FROM attribution_card a
      ),
      'notes', json_build_array(
        'Net sales = produktové riadky bez DPH (shipping excluded).',
        'UTM Real ROAS = net sales s utm_source meta/facebook (+ paid IG) / Meta spend.',
        'Meta reported ROAS = purchase conversion value / spend (ak value chýba, fallback purchases × AOV).',
        'Attribution split: 7d click + 1d view z Meta CSV; ak chýba, proxy = Meta value vs Shopify UTM.',
        CASE
          WHEN v_agency_fee_override IS NOT NULL THEN
            'Agency fee = alikvot (fee/dni v mesiaci × dni v období); od '
            || v_agency_fee_override_from::text || ' dočasný fix '
            || v_agency_fee_override::text || ' €/mes, kým nebudú faktúry.'
          ELSE
            'Agency fee = alikvot z poslednej faktúry (fee/dni v mesiaci × dni v období).'
        END
      )
    ),
    'decision', (
      SELECT json_build_object(
        'verdict', v.verdict_action,
        'verdict_label',
          CASE
            WHEN v.verdict_action = 'increase' THEN 'VERDIKT: ZVÝŠIŤ SPEND (+15%)'
            ELSE 'VERDIKT: NEZVYŠOVAŤ SPEND / REDUKOVAŤ BAZA'
          END,
        'fail_reasons', to_json(v.fail_reasons),
        'cards', json_build_object(
          'biznis', json_build_object(
            'id', 'biznis',
            'title', 'Biznis — zarábame?',
            'metric_label', 'Blended PNO',
            'metric_value', v.blended_pno_pct,
            'metric_unit', '%',
            'target', v_pno_target,
            'target_op', '<=',
            'status', v.biznis_status,
            'detail', json_build_object(
              'net_sales', ROUND(v.net_sales, 2),
              'meta_spend', ROUND(v.meta_spend, 2),
              'agency_fee', ROUND(v.agency_fee_14d, 2),
              'agency_fee_monthly', ROUND(v.agency_fee_monthly, 2),
              'agency_fee_as_of', v.agency_fee_as_of::text,
              'agency_fee_is_override', v.agency_fee_is_override,
              'total_spend', ROUND(v.total_spend, 2)
            )
          ),
          'trh', json_build_object(
            'id', 'trh',
            'title', 'Trh — nakupujú ľudia?',
            'metric_label', 'Store CR',
            'metric_value', v.store_cr_pct,
            'metric_unit', '%',
            'target', v_cr_target,
            'target_op', '>=',
            'status', v.trh_status,
            'detail', json_build_object(
              'orders', v.orders,
              'sessions', v.sessions,
              'days_with_sessions', v.days_with_sessions
            )
          ),
          'meta', json_build_object(
            'id', 'meta',
            'title', 'Meta efektivita — funguje reklama?',
            'metric_label', 'UTM Real ROAS',
            'metric_value', v.utm_real_roas,
            'metric_unit', '×',
            'target', v_roas_target,
            'target_op', '>=',
            'status', v.meta_status,
            'detail', json_build_object(
              'utm_meta_net_sales', ROUND(v.utm_meta_net_sales, 2),
              'utm_meta_orders', v.utm_meta_orders,
              'meta_spend', ROUND(v.meta_spend, 2),
              'meta_purchases', v.meta_purchases,
              'meta_purchase_value', ROUND(v.meta_purchase_value, 2),
              'meta_reported_sales', v.meta_reported_sales,
              'meta_reported_roas', v.meta_reported_roas,
              'meta_roas_is_actual', v.meta_roas_is_actual,
              -- backward-compatible aliases
              'meta_reported_roas_est', v.meta_reported_roas
            )
          )
        )
      )
      FROM verdict v
    ),
    'monthly', COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'month', m.month_key,
            'net_sales', m.net_sales,
            'orders', m.orders,
            'aov', m.aov,
            'meta_spend', m.meta_spend,
            'agency_fee', m.agency_fee,
            'total_spend', m.total_spend,
            'blended_pno_pct', m.blended_pno_pct,
            'sessions', m.sessions,
            'store_cr_pct', m.store_cr_pct,
            'utm_meta_net_sales', m.utm_meta_net_sales,
            'utm_real_roas', m.utm_real_roas,
            'meta_purchases', m.meta_purchases,
            'meta_purchase_value', m.meta_purchase_value,
            'meta_reported_sales', m.meta_reported_sales,
            'meta_reported_roas', m.meta_reported_roas,
            'meta_roas_is_actual', m.meta_roas_is_actual,
            'meta_click_sales', m.meta_click_sales,
            'meta_view_sales', m.meta_view_sales,
            'attribution_split_is_proxy', m.attribution_split_is_proxy,
            'meta_reported_sales_est', m.meta_reported_sales,
            'meta_reported_roas_est', m.meta_reported_roas,
            'meta_inflation_ratio', m.meta_inflation_ratio
          )
          ORDER BY m.month_key
        )
        FROM monthly m
      ),
      '[]'::json
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_executive_scaling_dashboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_executive_scaling_dashboard() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_executive_scaling_dashboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_executive_scaling_dashboard() TO anon;

COMMENT ON FUNCTION public.get_executive_scaling_dashboard() IS
  'Executive spend: MTD matrix + YTD. Agency 900€ override from 2026-07-01. Attribution cannibalization.';
