-- Jednotlivé marketingové náklady z denníka pre MER dashboard (filtrovateľná tabuľka).

CREATE OR REPLACE FUNCTION public.get_marketing_mer_expense_lines(
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
  SELECT b.d_from, b.d_to
  FROM public.shopify_dashboard_date_bounds(p_range, p_month, p_year) b
),
launch AS (
  SELECT make_date(2026, 1, 1)::date AS d_from
),
journal AS (
  SELECT
    j.line_hash,
    CASE
      WHEN j.doc_number = '3260023' THEN DATE '2026-03-01'
      ELSE j.entry_date
    END AS entry_date,
    j.doc_number,
    COALESCE(NULLIF(trim(j.partner_name), ''), NULLIF(trim(j.company_name), ''), 'Neznámy') AS supplier,
    j.line_text,
    j.debit_account,
    ROUND(j.amount_eur::numeric, 2) AS amount_eur,
    public.classify_journal_marketing_expense(
      j.line_text, j.partner_name, j.company_name, j.debit_account
    ) AS bucket,
    public.is_journal_agency_management_fee(
      j.line_text, j.partner_name, j.company_name, j.debit_account
    ) AS is_agency
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
),
classified AS (
  SELECT
    j.*,
    CASE
      WHEN j.bucket = 'google_ads' THEN 'google_ads'
      WHEN j.bucket = 'ads_skip' THEN 'ads_skip'
      WHEN j.bucket = 'fees' AND j.is_agency THEN 'agency'
      WHEN j.bucket = 'fees' THEN 'fees'
      ELSE 'unmapped'
    END AS role
  FROM journal j
  WHERE j.bucket IN ('fees', 'ads_skip', 'google_ads')
    OR (
      j.bucket IS NULL
      AND j.debit_account ~ '^(518|5015)'
      AND lower(concat_ws(' ', j.line_text, j.supplier))
        !~ '(^|\s)úhrada\s+fp|(^|\s)tb00'
    )
)
SELECT COALESCE(
  (
    SELECT json_agg(
      json_build_object(
        'line_hash', c.line_hash,
        'entry_date', c.entry_date,
        'doc_number', c.doc_number,
        'supplier', c.supplier,
        'line_text', c.line_text,
        'debit_account', c.debit_account,
        'amount_eur', c.amount_eur,
        'bucket', c.bucket,
        'role', c.role
      )
      ORDER BY c.entry_date DESC, c.amount_eur DESC, c.line_hash
    )
    FROM classified c
  ),
  '[]'::json
);
$$;

REVOKE ALL ON FUNCTION public.get_marketing_mer_expense_lines(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_marketing_mer_expense_lines(text, text, text) TO service_role;

COMMENT ON FUNCTION public.get_marketing_mer_expense_lines(text, text, text) IS
  'Riadkové marketingové náklady z accounting_journal_lines (fees, ads_skip, nemapované 518/5015).';
