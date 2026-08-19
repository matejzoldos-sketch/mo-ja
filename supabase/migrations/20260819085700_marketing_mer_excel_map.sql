-- Zaradenie 518/5015 podľa YTD reportu (Výsledky / Marketing & Promo).
-- Fees: VK, video, natáčanie, maskér, steli audit, konferencie/cestovné.
-- Exclude: LIDET/Feminea (staff), LeRi konzultácie (staff), YTD, SuperFaktura, právne, GS1.
-- VK je fees (Google agentúra), nie fee_category=agency — Spend PPC ostáva Filip/Honza.

INSERT INTO public.marketing_expense_map (priority, match_supplier, match_text, bucket, fee_category, notes)
SELECT 5, 'lidet', NULL, 'exclude', NULL, 'Staff / Leila — prednášky a poradenstvo (YTD Výsledky)'
WHERE NOT EXISTS (
  SELECT 1 FROM public.marketing_expense_map m
  WHERE m.match_supplier = 'lidet' AND m.bucket = 'exclude'
);

INSERT INTO public.marketing_expense_map (priority, match_supplier, match_text, bucket, fee_category, notes)
SELECT 6, 'leri', 'konzultač', 'exclude', NULL, 'Staff / Lenka — konzultácie, nie maskér'
WHERE NOT EXISTS (
  SELECT 1 FROM public.marketing_expense_map m
  WHERE m.match_supplier = 'leri' AND m.match_text = 'konzultač'
);

INSERT INTO public.marketing_expense_map (priority, match_supplier, match_text, bucket, fee_category, notes)
SELECT 7, 'ytd', NULL, 'exclude', NULL, 'Finance / reporting — mimo Marketing & Promo'
WHERE NOT EXISTS (
  SELECT 1 FROM public.marketing_expense_map m
  WHERE m.match_supplier = 'ytd' AND m.bucket = 'exclude'
);

INSERT INTO public.marketing_expense_map (priority, match_supplier, match_text, bucket, fee_category, notes)
SELECT 8, 'superfaktura', NULL, 'exclude', NULL, 'Office — SuperFaktura'
WHERE NOT EXISTS (
  SELECT 1 FROM public.marketing_expense_map m
  WHERE m.match_supplier = 'superfaktura' AND m.bucket = 'exclude'
);

INSERT INTO public.marketing_expense_map (priority, match_supplier, match_text, bucket, fee_category, notes)
SELECT 9, 'vida', NULL, 'exclude', NULL, 'Office — právne služby'
WHERE NOT EXISTS (
  SELECT 1 FROM public.marketing_expense_map m
  WHERE m.match_supplier = 'vida' AND m.bucket = 'exclude'
);

INSERT INTO public.marketing_expense_map (priority, match_supplier, match_text, bucket, fee_category, notes)
SELECT 10, 'feminea', NULL, 'exclude', NULL, 'Prednáška — mimo MER (ako LIDET)'
WHERE NOT EXISTS (
  SELECT 1 FROM public.marketing_expense_map m
  WHERE m.match_supplier = 'feminea' AND m.bucket = 'exclude'
);

INSERT INTO public.marketing_expense_map (priority, match_supplier, match_text, bucket, fee_category, notes)
SELECT 11, 'gs1', NULL, 'exclude', NULL, 'Ops — kódové označovanie'
WHERE NOT EXISTS (
  SELECT 1 FROM public.marketing_expense_map m
  WHERE m.match_supplier = 'gs1' AND m.bucket = 'exclude'
);

INSERT INTO public.marketing_expense_map (priority, match_supplier, match_text, bucket, fee_category, notes)
SELECT 20, 'vk marketing', NULL, 'fees', 'google_agency', 'Google agentúra (YTD Marketing & Promo)'
WHERE NOT EXISTS (
  SELECT 1 FROM public.marketing_expense_map m
  WHERE m.match_supplier = 'vk marketing' AND m.bucket = 'fees'
);

INSERT INTO public.marketing_expense_map (priority, match_text, bucket, fee_category, notes)
SELECT 21, 'nastavenie google ads', 'fees', 'google_agency', 'VK — nastavenie Google Ads'
WHERE NOT EXISTS (
  SELECT 1 FROM public.marketing_expense_map m
  WHERE m.match_text = 'nastavenie google ads' AND m.bucket = 'fees'
);

INSERT INTO public.marketing_expense_map (priority, match_supplier, match_text, bucket, fee_category, notes)
SELECT 22, 'bartoš', NULL, 'fees', 'agency', 'Meta agentúra — Honza Bartoš'
WHERE NOT EXISTS (
  SELECT 1 FROM public.marketing_expense_map m
  WHERE m.match_supplier = 'bartoš' AND m.bucket = 'fees'
);

INSERT INTO public.marketing_expense_map (priority, match_supplier, match_text, bucket, fee_category, notes)
SELECT 23, 'zelina', NULL, 'fees', 'creative', 'Video / Nadácia VW (YTD Marketing Video)'
WHERE NOT EXISTS (
  SELECT 1 FROM public.marketing_expense_map m
  WHERE m.match_supplier = 'zelina' AND m.bucket = 'fees'
);

INSERT INTO public.marketing_expense_map (priority, match_text, bucket, fee_category, notes)
SELECT 24, 'promo videí', 'fees', 'creative', 'Produkcia promo videí'
WHERE NOT EXISTS (
  SELECT 1 FROM public.marketing_expense_map m
  WHERE m.match_text = 'promo videí' AND m.bucket = 'fees'
);

INSERT INTO public.marketing_expense_map (priority, match_supplier, match_text, bucket, fee_category, notes)
SELECT 25, 'knižnica', NULL, 'fees', 'creative', 'Prenájom priestoru na natáčanie'
WHERE NOT EXISTS (
  SELECT 1 FROM public.marketing_expense_map m
  WHERE m.match_supplier = 'knižnica' AND m.bucket = 'fees'
);

INSERT INTO public.marketing_expense_map (priority, match_text, bucket, fee_category, notes)
SELECT 26, 'maskér', 'fees', 'creative', 'Maskérske práce (LeRi) — YTD Marketing Ostatné'
WHERE NOT EXISTS (
  SELECT 1 FROM public.marketing_expense_map m
  WHERE m.match_text = 'maskér' AND m.bucket = 'fees'
);

INSERT INTO public.marketing_expense_map (priority, match_supplier, match_text, bucket, fee_category, notes)
SELECT 27, 'steli', NULL, 'fees', 'fees', 'Marketingový audit / stratégia'
WHERE NOT EXISTS (
  SELECT 1 FROM public.marketing_expense_map m
  WHERE m.match_supplier = 'steli' AND m.bucket = 'fees'
);

INSERT INTO public.marketing_expense_map (priority, match_supplier, match_text, bucket, fee_category, notes)
SELECT 28, 'hup-zagreb', NULL, 'fees', 'events', 'Cestovné / e-commerce konferencia'
WHERE NOT EXISTS (
  SELECT 1 FROM public.marketing_expense_map m
  WHERE m.match_supplier = 'hup-zagreb' AND m.bucket = 'fees'
);

INSERT INTO public.marketing_expense_map (priority, match_supplier, match_text, bucket, fee_category, notes)
SELECT 29, 'studio echt', NULL, 'fees', 'events', 'Vstupenky Echt konferencia'
WHERE NOT EXISTS (
  SELECT 1 FROM public.marketing_expense_map m
  WHERE m.match_supplier = 'studio echt' AND m.bucket = 'fees'
);

INSERT INTO public.marketing_expense_map (priority, match_supplier, match_text, bucket, fee_category, notes)
SELECT 30, 'upterdam', NULL, 'fees', 'events', 'Konferencia'
WHERE NOT EXISTS (
  SELECT 1 FROM public.marketing_expense_map m
  WHERE m.match_supplier = 'upterdam' AND m.bucket = 'fees'
);

INSERT INTO public.marketing_expense_map (priority, match_supplier, match_text, bucket, fee_category, notes)
SELECT 31, 'serica', NULL, 'fees', 'events', 'E-commerce day vstupenka'
WHERE NOT EXISTS (
  SELECT 1 FROM public.marketing_expense_map m
  WHERE m.match_supplier = 'serica' AND m.bucket = 'fees'
);

CREATE OR REPLACE FUNCTION public.classify_journal_marketing_expense(
  p_text text,
  p_partner text,
  p_company text,
  p_debit_account text
)
RETURNS text
LANGUAGE plpgsql
STABLE
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

  IF v_hay ~ 'shopify|web\s*shop' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'stripe' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'visuel|údržba webu|udrzba webu' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'le\s*soft|čechovsk|cechovsk|projektov' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'ids\s*health' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'danetax|mof invest|swiss point|green\s*print' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'lidet|feminea' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'leri' AND v_hay ~ 'konzult' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'ytd s|finančný reporting|financny reporting' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'superfaktura' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'advokát|advokat|matej vida' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'gs1' THEN RETURN 'exclude'; END IF;
  IF v_acct LIKE '518220%' THEN RETURN 'exclude'; END IF;

  IF v_hay ~ 'meta\s*platforms|meta\s*reklamy' THEN RETURN 'ads_skip'; END IF;

  IF v_hay ~ 'filip|žitňansk|zitnansk|správa ppc|sprava ppc|ppc' THEN RETURN 'fees'; END IF;
  IF v_hay ~ 'vk\s*marketing|nastavenie google ads|bartoš|bartos' THEN RETURN 'fees'; END IF;
  IF v_hay ~ 'bcreativum|produkcia podcastu|reels' THEN RETURN 'fees'; END IF;
  IF v_hay ~ 'zelina|promo videí|promo videi|nadacia vw|nadácia vw' THEN RETURN 'fees'; END IF;
  IF v_hay ~ 'knižnica|kniznica|maskér|masker' THEN RETURN 'fees'; END IF;
  IF v_hay ~ 'steli' THEN RETURN 'fees'; END IF;
  IF v_hay ~ 'hup-zagreb|studio echt|upterdam|serica|e-commerce day|e-commerce konferencia' THEN RETURN 'fees'; END IF;
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

CREATE OR REPLACE FUNCTION public.is_journal_agency_management_fee(
  p_text text,
  p_partner text,
  p_company text,
  p_debit_account text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_hay text;
  r record;
BEGIN
  IF public.classify_journal_marketing_expense(
    p_text, p_partner, p_company, p_debit_account
  ) IS DISTINCT FROM 'fees' THEN
    RETURN false;
  END IF;

  v_hay := lower(
    concat_ws(
      ' ',
      coalesce(p_text, ''),
      coalesce(p_partner, ''),
      coalesce(p_company, '')
    )
  );

  FOR r IN
    SELECT 1
    FROM public.marketing_expense_map m
    WHERE m.fee_category = 'agency'
      AND m.bucket = 'fees'
      AND (m.match_text IS NULL OR v_hay LIKE '%' || lower(m.match_text) || '%')
      AND (
        m.match_supplier IS NULL
        OR v_hay LIKE '%' || lower(m.match_supplier) || '%'
      )
    LIMIT 1
  LOOP
    RETURN true;
  END LOOP;

  IF v_hay ~ 'správa\s*ppc|sprava\s*ppc|žitňansk|zitnansk|bartoš|bartos' THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.is_journal_agency_management_fee(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_journal_agency_management_fee(text, text, text, text) TO service_role;

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
    (
      SELECT COALESCE(SUM(li.quantity * COALESCE(li.unit_price, 0)), 0)::numeric
      FROM shopify_order_line_items li
      WHERE li.order_id = o.id
        AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title)
    ) AS product_revenue
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
ads_monthly AS (
  SELECT
    to_char(m.report_date, 'YYYY-MM') AS month_key,
    ROUND(COALESCE(SUM(m.spend_eur), 0), 2) AS ads_spend
  FROM meta_ads_campaign_daily m
  CROSS JOIN data_bounds db
  WHERE m.report_date >= db.d_from
    AND m.report_date <= db.d_to
  GROUP BY 1
),
journal_fees AS (
  SELECT
    j.entry_date,
    j.amount_eur,
    public.classify_journal_marketing_expense(
      j.line_text, j.partner_name, j.company_name, j.debit_account
    ) AS bucket,
    public.is_journal_agency_management_fee(
      j.line_text, j.partner_name, j.company_name, j.debit_account
    ) AS is_agency
  FROM accounting_journal_lines j
  CROSS JOIN data_bounds db
  WHERE j.entry_date >= db.d_from
    AND j.entry_date <= db.d_to
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
monthly AS (
  SELECT
    m.month_key,
    m.month_start,
    m.month_end,
    COALESCE(r.revenue, 0)::numeric AS revenue,
    COALESCE(r.orders, 0)::int AS orders,
    COALESCE(a.ads_spend, 0)::numeric AS ads_spend,
    COALESCE(f.fees_spend, 0)::numeric AS fees_spend,
    COALESCE(f.agency_fees_spend, 0)::numeric AS agency_fees_spend,
    (COALESCE(a.ads_spend, 0) + COALESCE(f.fees_spend, 0))::numeric AS total_mkt_spend
  FROM months m
  LEFT JOIN revenue_monthly r ON r.month_key = m.month_key
  LEFT JOIN ads_monthly a ON a.month_key = m.month_key
  LEFT JOIN fees_monthly f ON f.month_key = m.month_key
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
    to_char(j.entry_date, 'YYYY-MM') AS month,
    COALESCE(NULLIF(trim(j.partner_name), ''), NULLIF(trim(j.company_name), ''), 'Neznámy') AS label,
    ROUND(SUM(j.amount_eur), 2) AS amount_eur
  FROM accounting_journal_lines j
  CROSS JOIN bounds b
  CROSS JOIN launch la
  WHERE j.entry_date >= GREATEST(b.d_from, la.d_from)
    AND j.entry_date <= b.d_to
    AND public.classify_journal_marketing_expense(
      j.line_text, j.partner_name, j.company_name, j.debit_account
    ) = 'fees'
  GROUP BY 1, 2
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
      'journal_note', 'Fees z denníka podľa YTD Marketing & Promo; Ads z Meta CSV. mROAS = Revenue / (Ads + Fees agentúry: Správa PPC + VK Marketing Google).',
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
$$;

REVOKE ALL ON FUNCTION public.get_shopify_marketing_mer_dashboard(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shopify_marketing_mer_dashboard(text, text, text) TO service_role;

COMMENT ON FUNCTION public.get_shopify_marketing_mer_dashboard(text, text, text) IS
  'MER dashboard: MoM scorecards + mROAS + zoznam marketingových dodávateľov (fees/ads_skip).';
