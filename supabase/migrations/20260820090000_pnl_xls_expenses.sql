-- XLS expense line items (from "Výsledky" cost section) for supplier table in XLS/Hybrid P&L

CREATE TABLE IF NOT EXISTS public.pnl_xls_expenses_monthly (
  month_key text NOT NULL,
  year int NOT NULL,
  supplier text NOT NULL,
  account_prefix text NOT NULL DEFAULT '',
  amount_eur numeric NOT NULL DEFAULT 0,
  is_marketing boolean NOT NULL DEFAULT false,
  is_staff boolean NOT NULL DEFAULT false,
  PRIMARY KEY (month_key, supplier, account_prefix)
);

CREATE INDEX IF NOT EXISTS pnl_xls_expenses_monthly_year_idx
  ON public.pnl_xls_expenses_monthly (year);

CREATE OR REPLACE FUNCTION public.get_pnl_xls_dashboard(
  p_year text DEFAULT NULL
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH
params AS (
  SELECT
    COALESCE(p_year, to_char(now(), 'YYYY'))::int AS yr
),
journal_last AS (
  SELECT COALESCE(MAX(j.month_num), 0) AS last_actual_month
  FROM public.accounting_journal_lines j
  WHERE EXTRACT(YEAR FROM j.entry_date) = (SELECT yr FROM params)
),
rows AS (
  SELECT
    x.month_key,
    x.revenue,
    x.costs,
    x.profit_month,
    x.profit_ytd,
    x.marketing,
    x.opex,
    x.other_operating,
    x.staff
  FROM public.pnl_xls_results_monthly x
  JOIN params p ON p.yr = x.year
),
actual_rows AS (
  SELECT r.*
  FROM rows r
  CROSS JOIN journal_last jl
  WHERE jl.last_actual_month = 0
     OR substring(r.month_key from 6 for 2)::int <= jl.last_actual_month
),
totals AS (
  SELECT
    COALESCE(SUM(revenue), 0) AS revenue_ytd,
    COALESCE(SUM(costs), 0) AS costs_ytd,
    COALESCE((
      SELECT profit_ytd
      FROM actual_rows
      ORDER BY month_key DESC
      LIMIT 1
    ), 0) AS profit_ytd,
    COALESCE(SUM(marketing), 0) AS marketing_ytd,
    COALESCE(SUM(opex), 0) AS opex_ytd,
    COALESCE(SUM(other_operating), 0) AS other_operating_ytd,
    COALESCE(SUM(staff), 0) AS staff_ytd,
    COALESCE((
      SELECT to_date(month_key || '-01', 'YYYY-MM-DD')::date
      FROM actual_rows
      ORDER BY month_key ASC
      LIMIT 1
    ), CURRENT_DATE) AS from_date,
    COALESCE((
      SELECT to_date(month_key || '-01', 'YYYY-MM-DD')::date
      FROM actual_rows
      ORDER BY month_key DESC
      LIMIT 1
    ), CURRENT_DATE) AS to_date
  FROM actual_rows
),
top_expenses AS (
  SELECT
    e.supplier,
    e.account_prefix,
    ROUND(SUM(e.amount_eur), 2) AS amount_eur,
    COUNT(*)::int AS line_count,
    bool_or(e.is_marketing) AS is_marketing,
    bool_or(e.is_staff) AS is_staff
  FROM public.pnl_xls_expenses_monthly e
  JOIN params p ON p.yr = e.year
  CROSS JOIN journal_last jl
  WHERE jl.last_actual_month = 0
     OR substring(e.month_key from 6 for 2)::int <= jl.last_actual_month
  GROUP BY e.supplier, e.account_prefix
  HAVING ABS(SUM(e.amount_eur)) >= 0.5
  ORDER BY ABS(SUM(e.amount_eur)) DESC
)
SELECT json_build_object(
  'meta', json_build_object(
    'year', (SELECT yr FROM params),
    'from', (SELECT from_date FROM totals),
    'to', (SELECT to_date FROM totals),
    'last_actual_month', (SELECT last_actual_month FROM journal_last),
    'note', 'Hodnoty prevzate priamo z XLS sheet-u Vysledky + rozpad nakladovych poloziek.'
  ),
  'totals', (SELECT row_to_json(t) FROM totals t),
  'monthly', COALESCE(
    (SELECT json_agg(
      json_build_object(
        'month_key', r.month_key,
        'revenue', r.revenue,
        'costs', r.costs,
        'profit_month', r.profit_month,
        'profit_ytd', r.profit_ytd,
        'marketing', r.marketing,
        'opex', r.opex,
        'other_operating', r.other_operating,
        'staff', r.staff,
        'margin_pct', CASE WHEN r.revenue <> 0 THEN r.profit_month / r.revenue ELSE null END
      )
      ORDER BY r.month_key
    ) FROM actual_rows r),
    '[]'::json
  ),
  'topExpenses', COALESCE(
    (SELECT json_agg(row_to_json(te) ORDER BY te.amount_eur DESC) FROM top_expenses te),
    '[]'::json
  )
);
$$;

REVOKE ALL ON FUNCTION public.get_pnl_xls_dashboard(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pnl_xls_dashboard(text) TO service_role;
