-- Remap Filip agency FP 3260023 (2026-04-01) from April → March (paid for March in April).

-- Disable 900 € agency fee override.
-- Missing months (Jul/Aug): use Tatra honzabartos.cz debits as Meta agency fee.
-- March stays empty (other agency, no data in journal/bank).

-- CPA headroom softens hold → optimize (keep base, fix attribution, small test).
-- Decision window: mtd (default) | 14d | 30d via p_window.


CREATE OR REPLACE FUNCTION public.get_executive_scaling_dashboard(
  p_window text DEFAULT 'mtd'
)
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
  v_win_from date;
  v_window_key text;
  v_window_label text;
  v_pno_target CONSTANT numeric := 12.0;
  v_cr_target CONSTANT numeric := 1.8;
  v_roas_target CONSTANT numeric := 2.5;
  -- Contribution margin assumption until COGS sync exists (product margin excl. ads).
  v_contrib_margin_pct CONSTANT numeric := 50.0;
  -- Agency fee: journal first; if missing, Tatra debits honzabartos.cz (Meta agentúra).
  -- No fixed 900 € override. March left empty (other agency, no data).
  v_result json;
BEGIN
  v_window_key := lower(trim(COALESCE(p_window, 'mtd')));
  IF v_window_key NOT IN ('mtd', '14d', '30d') THEN
    v_window_key := 'mtd';
  END IF;

  IF v_window_key = '14d' THEN
    v_win_from := v_today - 13;
    v_window_label := 'posledných 14 dní';
  ELSIF v_window_key = '30d' THEN
    v_win_from := v_today - 29;
    v_window_label := 'posledných 30 dní';
  ELSE
    v_win_from := date_trunc('month', v_today::timestamp)::date;
    v_window_label := 'aktuálny mesiac (MTD)';
  END IF;
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
    WHERE o.created_at >= (LEAST(v_ytd_from, v_win_from)::timestamp AT TIME ZONE v_tz)
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
  agency_journal_by_month AS (
    SELECT
      -- Apr 1 FP 3260023 = March Filip fee booked one day late (paid in April).
      CASE
        WHEN j.doc_number = '3260023' THEN DATE '2026-03-01'
        WHEN j.entry_date = DATE '2026-04-01'
          AND (
            lower(coalesce(j.company_name, '')) LIKE '%žitňansk%'
            OR lower(coalesce(j.company_name, '')) LIKE '%zitnansk%'
          )
          THEN DATE '2026-03-01'
        ELSE date_trunc('month', j.entry_date)::date
      END AS month_start,
      ROUND(SUM(j.amount_eur)::numeric, 2) AS monthly_fee,
      MAX(j.entry_date) AS fee_as_of
    FROM accounting_journal_lines j
    WHERE public.is_journal_agency_management_fee(
      j.line_text, j.partner_name, j.company_name, j.debit_account
    )
      AND j.entry_date >= v_ytd_from
      AND j.entry_date <= v_win_to
    GROUP BY 1
  ),
  agency_bank_by_month AS (
    SELECT
      date_trunc('month', t.booking_date)::date AS month_start,
      ROUND(SUM(ABS(t.amount))::numeric, 2) AS monthly_fee,
      MAX(t.booking_date) AS fee_as_of
    FROM tatra_transactions t
    WHERE t.amount < 0
      AND t.booking_date >= v_ytd_from
      AND t.booking_date <= v_win_to
      AND (
        lower(coalesce(t.creditor_name, '')) LIKE '%honzabartos%'
        OR lower(coalesce(t.remittance_info, '')) LIKE '%honzabartos%'
      )
    GROUP BY 1
  ),
  -- Journal preferred; else honzabartos bank debit for that calendar month. No forward-fill.
  agency_fee_for_month AS (
    SELECT
      COALESCE(j.month_start, b.month_start) AS month_start,
      CASE
        WHEN COALESCE(j.monthly_fee, 0) > 0 THEN j.monthly_fee
        ELSE COALESCE(b.monthly_fee, 0)
      END AS monthly_fee,
      CASE
        WHEN COALESCE(j.monthly_fee, 0) > 0 THEN j.fee_as_of
        ELSE b.fee_as_of
      END AS fee_as_of,
      CASE
        WHEN COALESCE(j.monthly_fee, 0) > 0 THEN false
        WHEN COALESCE(b.monthly_fee, 0) > 0 THEN true
        ELSE false
      END AS is_bank_fallback
    FROM agency_journal_by_month j
    FULL OUTER JOIN agency_bank_by_month b ON b.month_start = j.month_start
  ),
  last_agency AS (
    SELECT
      fee_as_of,
      month_start AS fee_month,
      monthly_fee AS display_monthly_fee,
      is_bank_fallback,
      false AS is_override
    FROM agency_fee_for_month
    WHERE monthly_fee > 0
    ORDER BY fee_as_of DESC NULLS LAST
    LIMIT 1
  ),
  -- Alikvot: fee for each day's calendar month / days in that month.
  win_agency AS (
    SELECT
      COALESCE(
        ROUND(
          SUM(
            COALESCE(af.monthly_fee, 0)
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
      MAX(la.fee_as_of) AS agency_fee_as_of,
      false AS agency_fee_is_override,
      COALESCE(BOOL_OR(la.is_bank_fallback), false) AS agency_fee_is_bank_fallback
    FROM generate_series(v_win_from, v_win_to, interval '1 day') AS d(d)
    LEFT JOIN agency_fee_for_month af
      ON af.month_start = date_trunc('month', d.d::timestamp)::date
    LEFT JOIN last_agency la ON true
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
      (wa.meta_purchase_value > 0) AS meta_roas_is_actual,
      CASE
        WHEN ws.orders > 0 THEN ROUND(ws.net_sales / ws.orders, 2)
        ELSE NULL
      END AS aov,
      CASE
        WHEN wa.meta_purchases > 0
          THEN ROUND(wa.meta_spend / wa.meta_purchases, 2)
        ELSE NULL
      END AS meta_cpa,
      CASE
        WHEN ws.utm_meta_orders > 0
          THEN ROUND(wa.meta_spend / ws.utm_meta_orders::numeric, 2)
        ELSE NULL
      END AS utm_cac,
      CASE
        WHEN ws.orders > 0
          THEN ROUND((ws.net_sales / ws.orders) * (v_contrib_margin_pct / 100.0), 2)
        ELSE NULL
      END AS contrib_margin_eur
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
      END AS meta_status,
      CASE
        WHEN d.meta_cpa IS NULL OR d.contrib_margin_eur IS NULL THEN 'unknown'
        WHEN d.meta_cpa <= d.contrib_margin_eur THEN 'ok'
        ELSE 'warn'
      END AS cac_status
    FROM decision d
  ),
  verdict AS (
    SELECT
      ds.*,
      CASE
        WHEN ds.biznis_status = 'ok'
          AND ds.trh_status = 'ok'
          AND ds.meta_status = 'ok'
          AND ds.cac_status = 'ok'
          THEN 'increase'
        -- CPA still covers contribution margin: do not slash base; fix efficiency first.
        WHEN ds.cac_status = 'ok'
          AND ds.trh_status = 'ok'
          AND ds.meta_cpa IS NOT NULL
          AND ds.contrib_margin_eur IS NOT NULL
          AND ds.contrib_margin_eur > ds.meta_cpa
          THEN 'optimize'
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
          END,
          CASE
            WHEN ds.cac_status = 'warn' THEN
              'Meta CPA ' || ROUND(ds.meta_cpa, 2)::text || ' € > prírastková marža '
              || ROUND(ds.contrib_margin_eur, 2)::text || ' € (AOV × '
              || v_contrib_margin_pct::text || ' %)'
            WHEN ds.cac_status = 'unknown' THEN
              'Meta CPA nedostupné (chýbajú Meta purchases / AOV)'
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
  monthly_agency AS (
    SELECT
      m.month_key,
      COALESCE(af.monthly_fee, 0)::numeric AS agency_fee
    FROM months m
    LEFT JOIN agency_fee_for_month af ON af.month_start = m.month_start
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
      'window_key', v_window_key,
      'window_label', v_window_label,
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
      'agency_fee_is_bank_fallback', (
        SELECT agency_fee_is_bank_fallback FROM win_agency
      ),
      'targets', json_build_object(
        'blended_pno_pct_max', v_pno_target,
        'store_cr_pct_min', v_cr_target,
        'utm_real_roas_min', v_roas_target,
        'contrib_margin_pct', v_contrib_margin_pct
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
        'Meta CPA = Meta spend / Meta purchases (pixel). Target ≤ AOV × prírastková marža % (dočasný odhad, kým nie sú COGS). UTM CAC = Meta spend / Shopify UTM objednávky.',
        'Agency fee = denník (Správa PPC / agentúra); ak mesiac chýba, Tatra debet honzabartos.cz. FP 3260023 (1. 4.) priradená do marca. Alikvot = fee mesiaca / dni × dni v okne.'
      )
    ),
    'decision', (
      SELECT json_build_object(
        'verdict', v.verdict_action,
        'verdict_label',
          CASE
            WHEN v.verdict_action = 'increase' THEN 'VERDIKT: ZVÝŠIŤ SPEND (+15%)'
            WHEN v.verdict_action = 'optimize' THEN
              'VERDIKT: DRŽAŤ BÁZU · CPA MÁ REZERVU — oprav atribúciu, potom malý test'
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
          ),
          'cac', json_build_object(
            'id', 'cac',
            'title', 'Akvizícia — stojí zákazník?',
            'metric_label', 'Meta CPA',
            'metric_value', v.meta_cpa,
            'metric_unit', '€',
            'target', v.contrib_margin_eur,
            'target_op', '<=',
            'status', v.cac_status,
            'detail', json_build_object(
              'meta_spend', ROUND(v.meta_spend, 2),
              'meta_purchases', v.meta_purchases,
              'meta_cpa', v.meta_cpa,
              'utm_cac', v.utm_cac,
              'utm_meta_orders', v.utm_meta_orders,
              'aov', v.aov,
              'contrib_margin_pct', v_contrib_margin_pct,
              'contrib_margin_eur', v.contrib_margin_eur,
              'headroom_eur', CASE
                WHEN v.meta_cpa IS NOT NULL AND v.contrib_margin_eur IS NOT NULL
                  THEN ROUND(v.contrib_margin_eur - v.meta_cpa, 2)
                ELSE NULL
              END
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

REVOKE ALL ON FUNCTION public.get_executive_scaling_dashboard(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_executive_scaling_dashboard(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_executive_scaling_dashboard(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_executive_scaling_dashboard(text) TO anon;

COMMENT ON FUNCTION public.get_executive_scaling_dashboard(text) IS
  'Executive spend: window mtd|14d|30d + YTD. Agency = journal or Tatra honzabartos fallback (no 900 override). Meta CPA vs contrib. margin.';
