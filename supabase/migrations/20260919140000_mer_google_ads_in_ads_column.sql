-- Google Ads platform spend (denník bucket google_ads) → stĺpec Ads spolu s Meta CSV.
-- Meta FP v denníku ostáva ads_skip (double-count). VK Google agentúra ostáva vo Fees agentúra.

ALTER TABLE public.marketing_expense_map
  DROP CONSTRAINT IF EXISTS marketing_expense_map_bucket_check;

ALTER TABLE public.marketing_expense_map
  ADD CONSTRAINT marketing_expense_map_bucket_check
  CHECK (bucket IN ('fees', 'exclude', 'ads_skip', 'google_ads'));

UPDATE public.marketing_expense_map
SET bucket = 'google_ads'
WHERE bucket = 'ads_skip'
  AND fee_category = 'google_ads';

CREATE OR REPLACE FUNCTION public.get_shopify_marketing_mer_dashboard(p_range text DEFAULT '365d'::text, p_month text DEFAULT NULL::text, p_year text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH bounds AS (
  SELECT b.d_from, b.d_to, b.range_key, b.month_key
  FROM public.shopify_dashboard_date_bounds(p_range, p_month, p_year) b
),
-- Focus month for MoM scorecards (calendar month of selected month, else of d_to).
mom_bounds AS (
  SELECT
    date_trunc(
      'month',
      (CASE WHEN b.range_key = 'month' THEN b.d_from ELSE b.d_to END)::timestamp
    )::date AS d_from,
    LEAST(
      (
        date_trunc(
          'month',
          (CASE WHEN b.range_key = 'month' THEN b.d_from ELSE b.d_to END)::timestamp
        ) + interval '1 month - 1 day'
      )::date,
      b.d_to
    ) AS d_to
  FROM bounds b
),
-- Always previous calendar month vs focus month (MoM).
prev_bounds AS (
  SELECT
    (date_trunc('month', mb.d_from::timestamp) - interval '1 month')::date AS d_from,
    (mb.d_from - 1)::date AS d_to,
    'MoM'::text AS compare_kind
  FROM mom_bounds mb
),
-- MER reporting window starts 2026-01-01; extend left for previous-period KPIs.
data_bounds AS (
  SELECT
    LEAST(make_date(2026, 1, 1), pb.d_from, b.d_from, mb.d_from) AS d_from,
    GREATEST(b.d_to, pb.d_to, mb.d_to) AS d_to
  FROM bounds b
  CROSS JOIN prev_bounds pb
  CROSS JOIN mom_bounds mb
),
months AS (
  SELECT
    to_char(d, 'YYYY-MM') AS month_key,
    d::date AS month_start,
    (date_trunc('month', d::timestamp) + interval '1 month - 1 day')::date AS month_end
  FROM data_bounds db,
  LATERAL generate_series(
    date_trunc('month', db.d_from::timestamp),
    date_trunc('month', db.d_to::timestamp),
    interval '1 month'
  ) AS d
),
paid_orders AS (
  SELECT
    o.id,
    o.created_at,
    COALESCE(public.shopify_order_net_product_revenue(o.id), 0)::numeric AS product_revenue
  FROM shopify_orders o
  CROSS JOIN data_bounds db
  WHERE o.created_at >= (db.d_from::timestamp AT TIME ZONE 'Europe/Bratislava')
    AND o.created_at < ((db.d_to + 1)::timestamp AT TIME ZONE 'Europe/Bratislava')
    AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
      'PAID', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED'
    )
    AND public.shopify_order_has_product_line(o.id)
),
revenue_monthly AS (
  SELECT
    to_char((po.created_at AT TIME ZONE 'Europe/Bratislava')::date, 'YYYY-MM') AS month_key,
    ROUND(COALESCE(SUM(po.product_revenue), 0), 2) AS revenue,
    COUNT(*)::int AS orders
  FROM paid_orders po
  GROUP BY 1
),
journal_fees AS (
  SELECT
    -- FP 3260023 booked 2026-04-01 = March Filip agency fee (paid in April).
    CASE
      WHEN j.doc_number = '3260023' THEN DATE '2026-03-01'
      ELSE j.entry_date
    END AS entry_date,
    j.amount_eur,
    public.classify_journal_marketing_expense(
      j.line_text, j.partner_name, j.company_name, j.debit_account
    ) AS bucket,
    public.is_journal_agency_management_fee(
      j.line_text, j.partner_name, j.company_name, j.debit_account
    ) AS is_agency
  FROM accounting_journal_lines j
  CROSS JOIN data_bounds db
  WHERE CASE
      WHEN j.doc_number = '3260023' THEN DATE '2026-03-01'
      ELSE j.entry_date
    END >= db.d_from
    AND CASE
      WHEN j.doc_number = '3260023' THEN DATE '2026-03-01'
      ELSE j.entry_date
    END <= db.d_to
),
ads_monthly AS (
  SELECT
    u.month_key,
    ROUND(COALESCE(SUM(u.spend_eur), 0), 2) AS ads_spend
  FROM (
    SELECT
      to_char(m.report_date, 'YYYY-MM') AS month_key,
      m.spend_eur::numeric AS spend_eur
    FROM meta_ads_campaign_daily m
    CROSS JOIN data_bounds db
    WHERE m.report_date >= db.d_from
      AND m.report_date <= db.d_to
    UNION ALL
    SELECT
      to_char(jf.entry_date, 'YYYY-MM') AS month_key,
      jf.amount_eur::numeric AS spend_eur
    FROM journal_fees jf
    WHERE jf.bucket = 'google_ads'
  ) u
  GROUP BY 1
),
fees_monthly AS (
  SELECT
    to_char(jf.entry_date, 'YYYY-MM') AS month_key,
    ROUND(COALESCE(SUM(jf.amount_eur), 0), 2) AS fees_spend,
    ROUND(COALESCE(SUM(jf.amount_eur) FILTER (WHERE jf.is_agency), 0), 2) AS agency_fees_spend
  FROM journal_fees jf
  WHERE jf.bucket = 'fees'
  GROUP BY 1
),
-- Meta agency fee from Tatra when journal has no agency fee for the month (honzabartos.cz).
bank_agency_monthly AS (
  SELECT
    to_char(t.booking_date, 'YYYY-MM') AS month_key,
    ROUND(SUM(ABS(t.amount))::numeric, 2) AS agency_fee
  FROM tatra_transactions t
  CROSS JOIN data_bounds db
  WHERE t.amount < 0
    AND t.booking_date >= db.d_from
    AND t.booking_date <= db.d_to
    AND (
      lower(coalesce(t.creditor_name, '')) LIKE '%honzabartos%'
      OR lower(coalesce(t.remittance_info, '')) LIKE '%honzabartos%'
    )
  GROUP BY 1
),
monthly AS (
  SELECT
    s.month_key,
    s.month_start,
    s.month_end,
    s.revenue,
    s.orders,
    s.ads_spend,
    (s.non_agency_fees + s.agency_fees_spend)::numeric AS fees_spend,
    s.agency_fees_spend,
    (s.ads_spend + s.non_agency_fees + s.agency_fees_spend)::numeric AS total_mkt_spend
  FROM (
    SELECT
      m.month_key,
      m.month_start,
      m.month_end,
      COALESCE(r.revenue, 0)::numeric AS revenue,
      COALESCE(r.orders, 0)::int AS orders,
      COALESCE(a.ads_spend, 0)::numeric AS ads_spend,
      (COALESCE(f.fees_spend, 0) - COALESCE(f.agency_fees_spend, 0))::numeric AS non_agency_fees,
      CASE
        WHEN m.month_start = date_trunc('month', timezone('Europe/Bratislava', now())::timestamp)::date
        THEN ROUND(
          (
            CASE
              WHEN COALESCE(f.agency_fees_spend, 0) > 0 THEN f.agency_fees_spend
              WHEN COALESCE(b.agency_fee, 0) > 0 THEN b.agency_fee
              WHEN m.month_start >= DATE '2026-09-01' THEN 1014.71::numeric
              ELSE 0::numeric
            END
          ) * (
            (LEAST(m.month_end, (timezone('Europe/Bratislava', now()))::date) - m.month_start + 1)::numeric
            / (m.month_end - m.month_start + 1)::numeric
          ),
          2
        )
        ELSE
          CASE
            WHEN COALESCE(f.agency_fees_spend, 0) > 0 THEN f.agency_fees_spend
            WHEN COALESCE(b.agency_fee, 0) > 0 THEN b.agency_fee
            WHEN m.month_start >= DATE '2026-09-01' THEN 1014.71::numeric
            ELSE 0::numeric
          END
      END::numeric AS agency_fees_spend
    FROM months m
    LEFT JOIN revenue_monthly r ON r.month_key = m.month_key
    LEFT JOIN ads_monthly a ON a.month_key = m.month_key
    LEFT JOIN fees_monthly f ON f.month_key = m.month_key
    LEFT JOIN bank_agency_monthly b ON b.month_key = m.month_key
  ) s
),
launch AS (
  SELECT make_date(2026, 1, 1)::date AS d_from
),
monthly_filtered AS (
  SELECT mo.*
  FROM monthly mo
  CROSS JOIN bounds b
  CROSS JOIN launch la
  WHERE mo.month_end >= GREATEST(b.d_from, la.d_from)
    AND mo.month_start <= b.d_to
),
monthly_mom AS (
  SELECT mo.*
  FROM monthly mo
  CROSS JOIN mom_bounds mb
  WHERE mo.month_end >= mb.d_from
    AND mo.month_start <= mb.d_to
),
monthly_prev_period AS (
  SELECT mo.*
  FROM monthly mo
  CROSS JOIN prev_bounds pb
  WHERE mo.month_end >= pb.d_from
    AND mo.month_start <= pb.d_to
),
period_kpis AS (
  SELECT
    ROUND(COALESCE(SUM(mf.revenue), 0), 2) AS revenue,
    COALESCE(SUM(mf.orders), 0)::int AS orders,
    ROUND(COALESCE(SUM(mf.ads_spend), 0), 2) AS ads_spend,
    ROUND(COALESCE(SUM(mf.fees_spend), 0), 2) AS fees_spend,
    ROUND(COALESCE(SUM(mf.agency_fees_spend), 0), 2) AS agency_fees_spend,
    ROUND(COALESCE(SUM(mf.total_mkt_spend), 0), 2) AS total_mkt_spend
  FROM monthly_filtered mf
),
mom_period_kpis AS (
  SELECT
    ROUND(COALESCE(SUM(mm.revenue), 0), 2) AS revenue,
    COALESCE(SUM(mm.orders), 0)::int AS orders,
    ROUND(COALESCE(SUM(mm.ads_spend), 0), 2) AS ads_spend,
    ROUND(COALESCE(SUM(mm.fees_spend), 0), 2) AS fees_spend,
    ROUND(COALESCE(SUM(mm.agency_fees_spend), 0), 2) AS agency_fees_spend,
    ROUND(COALESCE(SUM(mm.total_mkt_spend), 0), 2) AS total_mkt_spend
  FROM monthly_mom mm
),
prev_period_kpis AS (
  SELECT
    ROUND(COALESCE(SUM(mp.revenue), 0), 2) AS revenue,
    COALESCE(SUM(mp.orders), 0)::int AS orders,
    ROUND(COALESCE(SUM(mp.ads_spend), 0), 2) AS ads_spend,
    ROUND(COALESCE(SUM(mp.fees_spend), 0), 2) AS fees_spend,
    ROUND(COALESCE(SUM(mp.agency_fees_spend), 0), 2) AS agency_fees_spend,
    ROUND(COALESCE(SUM(mp.total_mkt_spend), 0), 2) AS total_mkt_spend
  FROM monthly_prev_period mp
),
fees_breakdown AS (
  SELECT
    to_char(
      CASE
        WHEN j.doc_number = '3260023' THEN DATE '2026-03-01'
        ELSE j.entry_date
      END,
      'YYYY-MM'
    ) AS month,
    COALESCE(NULLIF(trim(j.partner_name), ''), NULLIF(trim(j.company_name), ''), 'Neznámy') AS label,
    ROUND(SUM(j.amount_eur), 2) AS amount_eur
  FROM accounting_journal_lines j
  CROSS JOIN bounds b
  CROSS JOIN launch la
  WHERE CASE
      WHEN j.doc_number = '3260023' THEN DATE '2026-03-01'
      ELSE j.entry_date
    END >= GREATEST(b.d_from, la.d_from)
    AND CASE
      WHEN j.doc_number = '3260023' THEN DATE '2026-03-01'
      ELSE j.entry_date
    END <= b.d_to
    AND public.classify_journal_marketing_expense(
      j.line_text, j.partner_name, j.company_name, j.debit_account
    ) = 'fees'
  GROUP BY 1, 2
  UNION ALL
  SELECT
    bam.month_key AS month,
    'Honza Bartoš (odhad banka)'::text AS label,
    bam.agency_fee AS amount_eur
  FROM bank_agency_monthly bam
  CROSS JOIN bounds b
  CROSS JOIN launch la
  WHERE to_date(bam.month_key || '-01', 'YYYY-MM-DD') >= date_trunc('month', GREATEST(b.d_from, la.d_from)::timestamp)::date
    AND to_date(bam.month_key || '-01', 'YYYY-MM-DD') <= b.d_to
    AND NOT EXISTS (
      SELECT 1
      FROM fees_monthly f
      WHERE f.month_key = bam.month_key
        AND COALESCE(f.agency_fees_spend, 0) > 0
    )
  UNION ALL
  SELECT
    to_char(m.month_start, 'YYYY-MM') AS month,
    'Honza Bartoš (fix 1014.71 €)'::text AS label,
    CASE
      WHEN m.month_start = date_trunc('month', timezone('Europe/Bratislava', now())::timestamp)::date
      THEN ROUND(
        1014.71::numeric * (
          (LEAST(m.month_end, (timezone('Europe/Bratislava', now()))::date) - m.month_start + 1)::numeric
          / (m.month_end - m.month_start + 1)::numeric
        ),
        2
      )
      ELSE 1014.71::numeric
    END AS amount_eur
  FROM months m
  CROSS JOIN bounds b
  CROSS JOIN launch la
  WHERE m.month_start >= DATE '2026-09-01'
    AND m.month_start >= date_trunc('month', GREATEST(b.d_from, la.d_from)::timestamp)::date
    AND m.month_start <= b.d_to
    AND NOT EXISTS (
      SELECT 1
      FROM fees_monthly f
      WHERE f.month_key = to_char(m.month_start, 'YYYY-MM')
        AND COALESCE(f.agency_fees_spend, 0) > 0
    )
    AND NOT EXISTS (
      SELECT 1
      FROM bank_agency_monthly bam
      WHERE bam.month_key = to_char(m.month_start, 'YYYY-MM')
        AND COALESCE(bam.agency_fee, 0) > 0
    )
),
unmapped AS (
  SELECT
    COALESCE(NULLIF(trim(j.partner_name), ''), NULLIF(trim(j.company_name), ''), 'Neznámy') AS label,
    j.line_text,
    j.debit_account,
    ROUND(SUM(j.amount_eur), 2) AS amount_eur
  FROM accounting_journal_lines j
  CROSS JOIN bounds b
  WHERE j.entry_date >= b.d_from
    AND j.entry_date <= b.d_to
    AND public.classify_journal_marketing_expense(
      j.line_text, j.partner_name, j.company_name, j.debit_account
    ) IS NULL
    AND j.debit_account ~ '^(518|5015)'
    AND lower(concat_ws(' ', j.line_text, j.partner_name, j.company_name))
      !~ '(^|\s)úhrada\s+fp|(^|\s)tb00'
  GROUP BY 1, 2, 3
  ORDER BY 4 DESC
  LIMIT 20
),
marketing_suppliers AS (
  SELECT
    COALESCE(NULLIF(trim(j.partner_name), ''), NULLIF(trim(j.company_name), ''), 'Neznámy') AS label,
    public.classify_journal_marketing_expense(
      j.line_text, j.partner_name, j.company_name, j.debit_account
    ) AS bucket,
    public.is_journal_agency_management_fee(
      j.line_text, j.partner_name, j.company_name, j.debit_account
    ) AS is_agency,
    ROUND(SUM(j.amount_eur), 2) AS amount_eur,
    COUNT(*)::int AS line_count,
    MIN(j.entry_date)::text AS first_date,
    MAX(j.entry_date)::text AS last_date
  FROM accounting_journal_lines j
  CROSS JOIN bounds b
  CROSS JOIN launch la
  WHERE j.entry_date >= GREATEST(b.d_from, la.d_from)
    AND j.entry_date <= b.d_to
    AND public.classify_journal_marketing_expense(
      j.line_text, j.partner_name, j.company_name, j.debit_account
    ) IN ('fees', 'ads_skip')
  GROUP BY 1, 2, 3
)
SELECT json_build_object(
  'meta', (
    SELECT json_build_object(
      'range', b.range_key,
      'from', GREATEST(b.d_from, la.d_from),
      'to', b.d_to,
      'month', b.month_key,
      'launch_from', la.d_from,
      'journal_note', 'Fees z denníka (YTD Marketing & Promo); FP 3260023 (1. 4.) = marec. Ak chýba agency fee: Tatra honzabartos, inak od 1. 9. 2026 dočasný fix 1014.71 € (11. 8.); aktuálny mesiac alikvot. Ads = Meta CSV + Google platforma (denník google_ads). Meta FP = ads_skip. mROAS = Revenue / (Ads + Fees agentúry). VK Google agentúra vo Fees agentúra.',
      'compareFrom', pb.d_from,
      'compareTo', pb.d_to,
      'compareKind', pb.compare_kind,
      'compareLabel', pb.compare_kind,
      'momFrom', mb.d_from,
      'momTo', mb.d_to
    )
    FROM bounds b
    CROSS JOIN prev_bounds pb
    CROSS JOIN mom_bounds mb
    CROSS JOIN launch la
    LIMIT 1
  ),
  'kpis', (
    SELECT json_build_object(
      'revenue', pk.revenue,
      'orders', pk.orders,
      'aov',
        CASE WHEN pk.orders > 0 THEN ROUND(pk.revenue / pk.orders, 2) ELSE NULL END,
      'ads_spend', pk.ads_spend,
      'fees_spend', pk.fees_spend,
      'agency_fees_spend', pk.agency_fees_spend,
      'total_mkt_spend', pk.total_mkt_spend,
      'currency', 'EUR',
      'mer',
        CASE WHEN pk.total_mkt_spend > 0 THEN ROUND(pk.revenue / pk.total_mkt_spend, 2) ELSE NULL END,
      'ad_roas',
        CASE WHEN pk.ads_spend > 0 THEN ROUND(pk.revenue / pk.ads_spend, 2) ELSE NULL END,
      'm_roas',
        CASE
          WHEN (pk.ads_spend + pk.agency_fees_spend) > 0
          THEN ROUND(pk.revenue / (pk.ads_spend + pk.agency_fees_spend), 2)
          ELSE NULL
        END
    )
    FROM period_kpis pk
  ),
  -- Focus month KPIs for MoM scorecard delta (vs kpisPrevious).
  'kpisMom', (
    SELECT json_build_object(
      'revenue', pk.revenue,
      'orders', pk.orders,
      'aov',
        CASE WHEN pk.orders > 0 THEN ROUND(pk.revenue / pk.orders, 2) ELSE NULL END,
      'ads_spend', pk.ads_spend,
      'fees_spend', pk.fees_spend,
      'agency_fees_spend', pk.agency_fees_spend,
      'total_mkt_spend', pk.total_mkt_spend,
      'currency', 'EUR',
      'mer',
        CASE WHEN pk.total_mkt_spend > 0 THEN ROUND(pk.revenue / pk.total_mkt_spend, 2) ELSE NULL END,
      'ad_roas',
        CASE WHEN pk.ads_spend > 0 THEN ROUND(pk.revenue / pk.ads_spend, 2) ELSE NULL END,
      'm_roas',
        CASE
          WHEN (pk.ads_spend + pk.agency_fees_spend) > 0
          THEN ROUND(pk.revenue / (pk.ads_spend + pk.agency_fees_spend), 2)
          ELSE NULL
        END
    )
    FROM mom_period_kpis pk
  ),
  'kpisPrevious', (
    SELECT json_build_object(
      'revenue', pk.revenue,
      'orders', pk.orders,
      'aov',
        CASE WHEN pk.orders > 0 THEN ROUND(pk.revenue / pk.orders, 2) ELSE NULL END,
      'ads_spend', pk.ads_spend,
      'fees_spend', pk.fees_spend,
      'agency_fees_spend', pk.agency_fees_spend,
      'total_mkt_spend', pk.total_mkt_spend,
      'currency', 'EUR',
      'mer',
        CASE WHEN pk.total_mkt_spend > 0 THEN ROUND(pk.revenue / pk.total_mkt_spend, 2) ELSE NULL END,
      'ad_roas',
        CASE WHEN pk.ads_spend > 0 THEN ROUND(pk.revenue / pk.ads_spend, 2) ELSE NULL END,
      'm_roas',
        CASE
          WHEN (pk.ads_spend + pk.agency_fees_spend) > 0
          THEN ROUND(pk.revenue / (pk.ads_spend + pk.agency_fees_spend), 2)
          ELSE NULL
        END
    )
    FROM prev_period_kpis pk
  ),
  'monthly', COALESCE(
    (
      SELECT json_agg(
        json_build_object(
          'month', mf.month_key,
          'revenue', mf.revenue,
          'orders', mf.orders,
          'aov',
            CASE WHEN mf.orders > 0 THEN ROUND(mf.revenue / mf.orders, 2) ELSE NULL END,
          'ads_spend', mf.ads_spend,
          'fees_spend', mf.fees_spend,
          'agency_fees_spend', mf.agency_fees_spend,
          'total_mkt_spend', mf.total_mkt_spend,
          'mer',
            CASE WHEN mf.total_mkt_spend > 0 THEN ROUND(mf.revenue / mf.total_mkt_spend, 2) ELSE NULL END,
          'ad_roas',
            CASE WHEN mf.ads_spend > 0 THEN ROUND(mf.revenue / mf.ads_spend, 2) ELSE NULL END,
          'm_roas',
            CASE
              WHEN (mf.ads_spend + mf.agency_fees_spend) > 0
              THEN ROUND(mf.revenue / (mf.ads_spend + mf.agency_fees_spend), 2)
              ELSE NULL
            END,
          'mom_revenue_pct',
            CASE
              WHEN prev_m.revenue > 0 THEN ROUND((mf.revenue - prev_m.revenue) / prev_m.revenue * 100, 1)
              ELSE NULL
            END,
          'yoy_revenue_pct',
            CASE
              WHEN prev_y.revenue > 0 THEN ROUND((mf.revenue - prev_y.revenue) / prev_y.revenue * 100, 1)
              ELSE NULL
            END
        )
        ORDER BY mf.month_key
      )
      FROM monthly_filtered mf
      LEFT JOIN monthly prev_m
        ON prev_m.month_key = to_char((to_date(mf.month_key || '-01', 'YYYY-MM-DD') - interval '1 month'), 'YYYY-MM')
      LEFT JOIN monthly prev_y
        ON prev_y.month_key = to_char((to_date(mf.month_key || '-01', 'YYYY-MM-DD') - interval '1 year'), 'YYYY-MM')
    ),
    '[]'::json
  ),
  'feesBreakdown', COALESCE((
    SELECT json_agg(
      json_build_object(
        'month', fb.month,
        'label', fb.label,
        'amount_eur', fb.amount_eur
      )
      ORDER BY fb.month, fb.amount_eur DESC
    )
    FROM fees_breakdown fb
  ), '[]'::json),
  'unmappedExpenses', COALESCE((SELECT json_agg(json_build_object('label', u.label, 'line_text', u.line_text, 'debit_account', u.debit_account, 'amount_eur', u.amount_eur)) FROM unmapped u), '[]'::json),
  'marketingSuppliers', COALESCE((
    SELECT json_agg(
      json_build_object(
        'label', s.label,
        'bucket', s.bucket,
        'role', CASE
          WHEN s.bucket = 'ads_skip' THEN 'ads_skip'
          WHEN s.is_agency THEN 'agency'
          ELSE 'fees'
        END,
        'amount_eur', s.amount_eur,
        'line_count', s.line_count,
        'first_date', s.first_date,
        'last_date', s.last_date
      )
      ORDER BY s.amount_eur DESC, s.label
    )
    FROM marketing_suppliers s
  ), '[]'::json)
);
$function$;
