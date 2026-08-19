-- Monthly Profit/Loss derived from MO-JA report XLS ("Výsledky" sheet)
-- Rows used:
-- - "Výnosy spolu (v účtovníctve)"
-- - "Náklady"
-- - "Výsledok za mesiac"
-- - "Výsledok kumulatívne"

CREATE TABLE IF NOT EXISTS public.pnl_xls_results_monthly (
  month_key text PRIMARY KEY, -- YYYY-MM
  year int NOT NULL,
  revenue numeric NOT NULL,
  costs numeric NOT NULL,
  profit_month numeric NOT NULL,
  profit_ytd numeric NOT NULL
);

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
    x.profit_ytd
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
)
SELECT json_build_object(
  'meta', json_build_object(
    'year', (SELECT yr FROM params),
    'from', (SELECT from_date FROM totals),
    'to', (SELECT to_date FROM totals),
    'note', 'Hodnoty prevzaté priamo z XLS sheet-u "Výsledky" (Výnosy/Náklady/Zisk za mesiac a YTD).'
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

