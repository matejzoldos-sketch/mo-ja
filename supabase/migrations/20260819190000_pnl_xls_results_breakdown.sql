-- XLS cost breakdown support (marketing/opex/other) for D2C cost-structure table

ALTER TABLE public.pnl_xls_results_monthly
  ADD COLUMN IF NOT EXISTS marketing numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opex numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_operating numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS staff numeric NOT NULL DEFAULT 0;

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
totals AS (
  SELECT
    COALESCE(SUM(revenue), 0) AS revenue_ytd,
    COALESCE(SUM(costs), 0) AS costs_ytd,
    COALESCE((
      SELECT profit_ytd
      FROM rows
      ORDER BY month_key DESC
      LIMIT 1
    ), 0) AS profit_ytd,
    COALESCE(SUM(marketing), 0) AS marketing_ytd,
    COALESCE(SUM(opex), 0) AS opex_ytd,
    COALESCE(SUM(other_operating), 0) AS other_operating_ytd,
    COALESCE(SUM(staff), 0) AS staff_ytd,
    COALESCE((
      SELECT to_date(month_key || '-01', 'YYYY-MM-DD')::date
      FROM rows
      ORDER BY month_key ASC
      LIMIT 1
    ), CURRENT_DATE) AS from_date,
    COALESCE((
      SELECT to_date(month_key || '-01', 'YYYY-MM-DD')::date
      FROM rows
      ORDER BY month_key DESC
      LIMIT 1
    ), CURRENT_DATE) AS to_date
  FROM rows
),
journal_last AS (
  SELECT COALESCE(MAX(j.month_num), 0) AS last_actual_month
  FROM public.accounting_journal_lines j
  WHERE EXTRACT(YEAR FROM j.entry_date) = (SELECT yr FROM params)
)
SELECT json_build_object(
  'meta', json_build_object(
    'year', (SELECT yr FROM params),
    'from', (SELECT from_date FROM totals),
    'to', (SELECT to_date FROM totals),
    'last_actual_month', (SELECT last_actual_month FROM journal_last),
    'note', 'Hodnoty prevzaté priamo z XLS sheet-u \"Výsledky\" + doplnený rozpad (Marketing/OPEX/Ostatné).'
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
    ) FROM rows r),
    '[]'::json
  )
);
$$;

REVOKE ALL ON FUNCTION public.get_pnl_xls_dashboard(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pnl_xls_dashboard(text) TO service_role;

