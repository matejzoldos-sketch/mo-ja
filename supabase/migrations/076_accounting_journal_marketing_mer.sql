-- Účtovný denník (import CSV) + klasifikácia marketingových nákladov + MER dashboard.

CREATE TABLE IF NOT EXISTS public.accounting_journal_lines (
  line_hash text PRIMARY KEY,
  entry_date date NOT NULL,
  month_num smallint,
  doc_number text NOT NULL,
  line_text text NOT NULL DEFAULT '',
  debit_account text NOT NULL,
  credit_account text NOT NULL,
  amount_eur numeric NOT NULL,
  company_name text,
  partner_name text,
  source_row integer,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS accounting_journal_lines_entry_date_idx
  ON public.accounting_journal_lines (entry_date);

CREATE INDEX IF NOT EXISTS accounting_journal_lines_debit_account_idx
  ON public.accounting_journal_lines (debit_account);

ALTER TABLE public.accounting_journal_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read accounting_journal_lines" ON public.accounting_journal_lines;
CREATE POLICY "Public read accounting_journal_lines"
  ON public.accounting_journal_lines
  FOR SELECT
  USING (true);

GRANT SELECT ON public.accounting_journal_lines TO anon, authenticated, service_role;

COMMENT ON TABLE public.accounting_journal_lines IS
  'Import účtovného denníka (CSV). Marketing Fees z MD 518xxx / 501500, bez bankových úhrad FP.';

-- Voliteľné override pravidlá (priority nižšie = skôr).
CREATE TABLE IF NOT EXISTS public.marketing_expense_map (
  id serial PRIMARY KEY,
  priority integer NOT NULL DEFAULT 100,
  match_supplier text,
  match_text text,
  match_account text,
  bucket text NOT NULL CHECK (bucket IN ('fees', 'exclude', 'ads_skip')),
  fee_category text,
  notes text
);

ALTER TABLE public.marketing_expense_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read marketing_expense_map" ON public.marketing_expense_map;
CREATE POLICY "Public read marketing_expense_map"
  ON public.marketing_expense_map
  FOR SELECT
  USING (true);

GRANT SELECT ON public.marketing_expense_map TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.classify_journal_marketing_expense(
  p_text text,
  p_partner text,
  p_company text,
  p_debit_account text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_hay text;
  v_acct text;
  r record;
BEGIN
  v_hay := lower(
    concat_ws(
      ' ',
      coalesce(p_text, ''),
      coalesce(p_partner, ''),
      coalesce(p_company, '')
    )
  );
  v_acct := trim(coalesce(p_debit_account, ''));

  IF v_acct = '' THEN
    RETURN NULL;
  END IF;

  -- Len nákladové zápisy (nie bankové úhrady).
  IF v_hay ~ '(^|\s)úhrada\s+fp|(^|\s)tb00' THEN
    RETURN NULL;
  END IF;

  IF v_acct !~ '^(518|5015)' THEN
    RETURN NULL;
  END IF;

  FOR r IN
    SELECT m.bucket
    FROM public.marketing_expense_map m
    WHERE (m.match_account IS NULL OR v_acct LIKE m.match_account || '%')
      AND (m.match_text IS NULL OR v_hay LIKE '%' || lower(m.match_text) || '%')
      AND (
        m.match_supplier IS NULL
        OR v_hay LIKE '%' || lower(m.match_supplier) || '%'
      )
    ORDER BY m.priority ASC, m.id ASC
    LIMIT 1
  LOOP
    RETURN r.bucket;
  END LOOP;

  -- Default pravidlá (súlad s cashflowMarketingMap / dohoda s klientom).
  IF v_hay ~ 'shopify|web\s*shop' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'stripe' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'visuel|údržba webu|udrzba webu' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'le\s*soft|čechovsk|cechovsk|projektov' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'ids\s*health' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'danetax|mof invest|swiss point|green\s*print' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'meta\s*platforms|meta\s*reklamy' THEN RETURN 'ads_skip'; END IF;

  IF v_hay ~ 'filip|žitňansk|zitnansk|správa ppc|sprava ppc|ppc' THEN RETURN 'fees'; END IF;
  IF v_hay ~ 'bcreativum|produkcia podcastu|reels' THEN RETURN 'fees'; END IF;
  IF v_hay ~ 'mailerlite|mailersend|mailer' THEN RETURN 'fees'; END IF;
  IF v_hay ~ 'manychat|chatovac' THEN RETURN 'fees'; END IF;
  IF v_hay ~ 'canva' THEN RETURN 'fees'; END IF;
  IF v_hay ~ 'agnw|dizajn\s*manu' THEN RETURN 'fees'; END IF;
  IF v_hay ~ 'kurečkov|kureckov|ideamaking|copywriting' THEN RETURN 'fees'; END IF;
  IF v_hay ~ 'asaprint|letáky|letaky|marketingový materiál|marketingovy material' THEN RETURN 'fees'; END IF;
  IF v_hay ~ 'birne\s*studio|inputflow' THEN RETURN 'fees'; END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.classify_journal_marketing_expense(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classify_journal_marketing_expense(text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_shopify_marketing_mer_dashboard(
  p_range text DEFAULT '365d',
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
launch_bounds AS (
  SELECT
    make_date(2026, 1, 1) AS d_from,
    (SELECT d_to FROM bounds) AS d_to
),
months AS (
  SELECT
    to_char(d, 'YYYY-MM') AS month_key,
    d::date AS month_start,
    (date_trunc('month', d::timestamp) + interval '1 month - 1 day')::date AS month_end
  FROM launch_bounds lb,
  LATERAL generate_series(
    date_trunc('month', lb.d_from::timestamp),
    date_trunc('month', lb.d_to::timestamp),
    interval '1 month'
  ) AS d
),
paid_orders AS (
  SELECT
    o.id,
    o.created_at,
    (
      SELECT COALESCE(SUM(li.quantity * COALESCE(li.unit_price, 0)), 0)::numeric
      FROM shopify_order_line_items li
      WHERE li.order_id = o.id
        AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title)
    ) AS product_revenue
  FROM shopify_orders o
  CROSS JOIN launch_bounds lb
  WHERE o.created_at >= (lb.d_from::timestamp AT TIME ZONE 'Europe/Bratislava')
    AND o.created_at < ((lb.d_to + 1)::timestamp AT TIME ZONE 'Europe/Bratislava')
    AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
      'PAID', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED'
    )
    AND public.shopify_order_has_product_line(o.id)
),
revenue_monthly AS (
  SELECT
    to_char((po.created_at AT TIME ZONE 'Europe/Bratislava')::date, 'YYYY-MM') AS month_key,
    ROUND(COALESCE(SUM(po.product_revenue), 0), 2) AS revenue
  FROM paid_orders po
  GROUP BY 1
),
ads_monthly AS (
  SELECT
    to_char(m.report_date, 'YYYY-MM') AS month_key,
    ROUND(COALESCE(SUM(m.spend_eur), 0), 2) AS ads_spend
  FROM meta_ads_campaign_daily m
  CROSS JOIN launch_bounds lb
  WHERE m.report_date >= lb.d_from
    AND m.report_date <= lb.d_to
  GROUP BY 1
),
journal_fees AS (
  SELECT
    j.entry_date,
    j.amount_eur,
    public.classify_journal_marketing_expense(
      j.line_text, j.partner_name, j.company_name, j.debit_account
    ) AS bucket
  FROM accounting_journal_lines j
  CROSS JOIN launch_bounds lb
  WHERE j.entry_date >= lb.d_from
    AND j.entry_date <= lb.d_to
),
fees_monthly AS (
  SELECT
    to_char(jf.entry_date, 'YYYY-MM') AS month_key,
    ROUND(COALESCE(SUM(jf.amount_eur), 0), 2) AS fees_spend
  FROM journal_fees jf
  WHERE jf.bucket = 'fees'
  GROUP BY 1
),
monthly AS (
  SELECT
    m.month_key,
    m.month_start,
    m.month_end,
    COALESCE(r.revenue, 0)::numeric AS revenue,
    COALESCE(a.ads_spend, 0)::numeric AS ads_spend,
    COALESCE(f.fees_spend, 0)::numeric AS fees_spend,
    (COALESCE(a.ads_spend, 0) + COALESCE(f.fees_spend, 0))::numeric AS total_mkt_spend
  FROM months m
  LEFT JOIN revenue_monthly r ON r.month_key = m.month_key
  LEFT JOIN ads_monthly a ON a.month_key = m.month_key
  LEFT JOIN fees_monthly f ON f.month_key = m.month_key
),
monthly_filtered AS (
  SELECT mo.*
  FROM monthly mo
  CROSS JOIN bounds b
  WHERE mo.month_end >= b.d_from
    AND mo.month_start <= b.d_to
),
period_kpis AS (
  SELECT
    ROUND(COALESCE(SUM(mf.revenue), 0), 2) AS revenue,
    ROUND(COALESCE(SUM(mf.ads_spend), 0), 2) AS ads_spend,
    ROUND(COALESCE(SUM(mf.fees_spend), 0), 2) AS fees_spend,
    ROUND(COALESCE(SUM(mf.total_mkt_spend), 0), 2) AS total_mkt_spend
  FROM monthly_filtered mf
),
fees_breakdown AS (
  SELECT
    COALESCE(NULLIF(trim(j.partner_name), ''), NULLIF(trim(j.company_name), ''), 'Neznámy') AS label,
    ROUND(SUM(j.amount_eur), 2) AS amount_eur
  FROM accounting_journal_lines j
  CROSS JOIN bounds b
  WHERE j.entry_date >= b.d_from
    AND j.entry_date <= b.d_to
    AND public.classify_journal_marketing_expense(
      j.line_text, j.partner_name, j.company_name, j.debit_account
    ) = 'fees'
  GROUP BY 1
  ORDER BY 2 DESC
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
)
SELECT json_build_object(
  'meta', (
    SELECT json_build_object(
      'range', b.range_key,
      'from', b.d_from,
      'to', b.d_to,
      'month', b.month_key,
      'launch_from', lb.d_from,
      'journal_note', 'Fees z denníka; Ads z meta_ads_campaign_daily (nie Meta FP v denníku).'
    )
    FROM bounds b
    CROSS JOIN launch_bounds lb
    LIMIT 1
  ),
  'kpis', (
    SELECT json_build_object(
      'revenue', pk.revenue,
      'ads_spend', pk.ads_spend,
      'fees_spend', pk.fees_spend,
      'total_mkt_spend', pk.total_mkt_spend,
      'currency', 'EUR',
      'mer',
        CASE WHEN pk.total_mkt_spend > 0 THEN ROUND(pk.revenue / pk.total_mkt_spend, 2) ELSE NULL END,
      'ad_roas',
        CASE WHEN pk.ads_spend > 0 THEN ROUND(pk.revenue / pk.ads_spend, 2) ELSE NULL END
    )
    FROM period_kpis pk
  ),
  'monthly', COALESCE(
    (
      SELECT json_agg(
        json_build_object(
          'month', mf.month_key,
          'revenue', mf.revenue,
          'ads_spend', mf.ads_spend,
          'fees_spend', mf.fees_spend,
          'total_mkt_spend', mf.total_mkt_spend,
          'mer',
            CASE WHEN mf.total_mkt_spend > 0 THEN ROUND(mf.revenue / mf.total_mkt_spend, 2) ELSE NULL END,
          'ad_roas',
            CASE WHEN mf.ads_spend > 0 THEN ROUND(mf.revenue / mf.ads_spend, 2) ELSE NULL END,
          'yoy_revenue_pct',
            CASE
              WHEN prev.revenue > 0 THEN ROUND((mf.revenue - prev.revenue) / prev.revenue * 100, 1)
              ELSE NULL
            END
        )
        ORDER BY mf.month_key
      )
      FROM monthly_filtered mf
      LEFT JOIN monthly prev
        ON prev.month_key = to_char((to_date(mf.month_key || '-01', 'YYYY-MM-DD') - interval '1 year'), 'YYYY-MM')
    ),
    '[]'::json
  ),
  'feesBreakdown', COALESCE((SELECT json_agg(json_build_object('label', fb.label, 'amount_eur', fb.amount_eur)) FROM fees_breakdown fb), '[]'::json),
  'unmappedExpenses', COALESCE((SELECT json_agg(json_build_object('label', u.label, 'line_text', u.line_text, 'debit_account', u.debit_account, 'amount_eur', u.amount_eur)) FROM unmapped u), '[]'::json)
);
$$;

REVOKE ALL ON FUNCTION public.get_shopify_marketing_mer_dashboard(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shopify_marketing_mer_dashboard(text, text, text) TO service_role;

COMMENT ON FUNCTION public.get_shopify_marketing_mer_dashboard(text, text, text) IS
  'MER dashboard: Shopify revenue + Meta CSV ads + journal fees; mesačný vývoj od 1.1.2026 (kompletný denník).';
