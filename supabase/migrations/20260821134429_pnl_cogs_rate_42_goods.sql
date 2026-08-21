-- Hybrid + accounting P&L: COGS 42 % of net product sales (Orin unit cost × units / H1 mix).
-- revenue_goods = XLS product revenue after discounts, excluding shipping/services.

ALTER TABLE public.pnl_xls_results_monthly
  ADD COLUMN IF NOT EXISTS revenue_goods numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.pnl_xls_results_monthly.revenue_goods IS
  'Net product sales (XLS produkty minus zlav, bez dopravy a sluzieb). Hybrid COGS base.';

CREATE OR REPLACE FUNCTION public.get_pnl_dashboard(
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
    COALESCE(p_year, to_char(now(), 'YYYY')) AS yr
),
year_bounds AS (
  SELECT
    (p.yr || '-01-01')::date AS d_from,
    LEAST((p.yr || '-12-31')::date, CURRENT_DATE) AS d_to
  FROM params p
),
lines AS (
  SELECT
    j.entry_date,
    to_char(j.entry_date, 'YYYY-MM') AS month_key,
    j.debit_account,
    j.credit_account,
    j.amount_eur,
    j.line_text,
    COALESCE(
      NULLIF(trim(j.partner_name), ''),
      NULLIF(trim(j.company_name), ''),
      left(coalesce(j.line_text, ''), 80)
    ) AS label
  FROM accounting_journal_lines j
  CROSS JOIN year_bounds yb
  WHERE j.entry_date >= yb.d_from
    AND j.entry_date <= yb.d_to
),
last_month AS (
  SELECT COALESCE(MAX(month_key), (SELECT yr FROM params) || '-01') AS month_key
  FROM lines
),
revenue_monthly AS (
  SELECT
    l.month_key,
    ROUND(SUM(l.amount_eur) FILTER (WHERE l.credit_account ~ '^604'), 2) AS sales_goods,
    ROUND(SUM(l.amount_eur) FILTER (WHERE l.credit_account ~ '^602'), 2) AS sales_services,
    ROUND(SUM(l.amount_eur) FILTER (WHERE l.credit_account ~ '^6' AND l.credit_account !~ '^604|^602'), 2) AS other_revenue,
    ROUND(SUM(l.amount_eur) FILTER (WHERE l.credit_account ~ '^6'), 2) AS total_revenue
  FROM lines l
  WHERE l.credit_account ~ '^6'
  GROUP BY 1
),
cogs_monthly AS (
  SELECT
    l.month_key,
    ROUND(SUM(l.amount_eur), 2) AS cogs
  FROM lines l
  WHERE l.debit_account ~ '^504'
  GROUP BY 1
),
expense_monthly AS (
  SELECT
    l.month_key,
    ROUND(SUM(l.amount_eur) FILTER (WHERE l.debit_account ~ '^501'), 2) AS material,
    ROUND(SUM(l.amount_eur) FILTER (WHERE l.debit_account ~ '^513'), 2) AS representation,
    ROUND(SUM(l.amount_eur) FILTER (WHERE l.debit_account ~ '^518'), 2) AS services,
    ROUND(SUM(l.amount_eur) FILTER (WHERE l.debit_account ~ '^538'), 2) AS taxes_fees,
    ROUND(SUM(l.amount_eur) FILTER (WHERE l.debit_account ~ '^548'), 2) AS other_operating,
    ROUND(SUM(l.amount_eur) FILTER (WHERE l.debit_account ~ '^56'), 2) AS financial,
    ROUND(SUM(l.amount_eur) FILTER (WHERE l.debit_account ~ '^5' AND l.debit_account !~ '^504'), 2) AS total_opex
  FROM lines l
  WHERE l.debit_account ~ '^5' AND l.debit_account !~ '^504'
  GROUP BY 1
),
staff_monthly AS (
  SELECT
    l.month_key,
    ROUND(SUM(l.amount_eur), 2) AS staff_spend
  FROM lines l
  WHERE l.debit_account ~ '^518'
    AND (
      lower(l.label) LIKE '%lidet%'
      OR lower(l.label) LIKE '%leri s.r.o%'
      OR lower(l.label) LIKE '%zelina%'
      OR l.label ~ 'echovsk'
      OR l.label ~ 'ure.kov'
    )
  GROUP BY 1
),
marketing_monthly AS (
  SELECT
    l.month_key,
    ROUND(SUM(l.amount_eur) FILTER (
      WHERE public.classify_journal_marketing_expense(l.line_text, l.label, l.label, l.debit_account) IN ('fees', 'ads_skip')
    ), 2) AS marketing_spend
  FROM lines l
  WHERE l.debit_account ~ '^518|^5015'
  GROUP BY 1
),
months AS (
  SELECT DISTINCT month_key FROM (
    SELECT month_key FROM revenue_monthly
    UNION SELECT month_key FROM cogs_monthly
    UNION SELECT month_key FROM expense_monthly
  ) x
),
monthly AS (
  SELECT
    m.month_key,
    COALESCE(r.sales_goods, 0) AS sales_goods,
    COALESCE(r.sales_services, 0) AS sales_services,
    COALESCE(r.other_revenue, 0) AS other_revenue,
    COALESCE(r.total_revenue, 0) AS total_revenue,
    COALESCE(c.cogs, 0) AS cogs_journal,
    ROUND(COALESCE(r.sales_goods, 0) * 0.42, 2) AS cogs_estimated,
    GREATEST(COALESCE(c.cogs, 0), ROUND(COALESCE(r.sales_goods, 0) * 0.42, 2)) AS cogs,
    (COALESCE(r.total_revenue, 0) - GREATEST(COALESCE(c.cogs, 0), ROUND(COALESCE(r.sales_goods, 0) * 0.42, 2))) AS gross_profit,
    COALESCE(e.material, 0) AS material,
    COALESCE(e.representation, 0) AS representation,
    COALESCE(e.services, 0) AS services,
    COALESCE(e.taxes_fees, 0) AS taxes_fees,
    COALESCE(e.other_operating, 0) AS other_operating,
    COALESCE(e.financial, 0) AS financial,
    COALESCE(e.total_opex, 0) AS total_opex,
    COALESCE(mk.marketing_spend, 0) AS marketing_spend,
    COALESCE(st.staff_spend, 0) AS staff_spend,
    (COALESCE(r.total_revenue, 0) - GREATEST(COALESCE(c.cogs, 0), ROUND(COALESCE(r.sales_goods, 0) * 0.42, 2)) - COALESCE(e.total_opex, 0)) AS contribution_margin
  FROM months m
  LEFT JOIN revenue_monthly r ON r.month_key = m.month_key
  LEFT JOIN cogs_monthly c ON c.month_key = m.month_key
  LEFT JOIN expense_monthly e ON e.month_key = m.month_key
  LEFT JOIN marketing_monthly mk ON mk.month_key = m.month_key
  LEFT JOIN staff_monthly st ON st.month_key = m.month_key
),
top_expenses AS (
  SELECT
    l.label AS supplier,
    LEFT(l.debit_account, 3) AS account_prefix,
    ROUND(SUM(l.amount_eur), 2) AS amount_eur,
    COUNT(*)::int AS line_count,
    bool_or(
      (
        l.debit_account ~ '^518|^5015'
        AND public.classify_journal_marketing_expense(l.line_text, l.label, l.label, l.debit_account) IN ('fees', 'ads_skip')
      )
      OR (
        lower(l.label) LIKE '%meta%platforms%'
        OR lower(l.label) LIKE '%meta%reklamy%'
      )
    ) AS is_marketing,
    bool_or(
      l.debit_account ~ '^518'
      AND (
        lower(l.label) LIKE '%lidet%'
        OR lower(l.label) LIKE '%leri s.r.o%'
        OR lower(l.label) LIKE '%zelina%'
        OR l.label ~ 'echovsk'
        OR l.label ~ 'ure.kov'
      )
    ) AS is_staff
  FROM lines l
  WHERE l.debit_account ~ '^5'
  GROUP BY 1, 2
  HAVING ABS(SUM(l.amount_eur)) >= 0.5
  ORDER BY 3 DESC
),
top_expenses_last_month AS (
  SELECT
    l.label AS supplier,
    LEFT(l.debit_account, 3) AS account_prefix,
    ROUND(SUM(l.amount_eur), 2) AS amount_eur,
    COUNT(*)::int AS line_count,
    bool_or(
      (
        l.debit_account ~ '^518|^5015'
        AND public.classify_journal_marketing_expense(l.line_text, l.label, l.label, l.debit_account) IN ('fees', 'ads_skip')
      )
      OR (
        lower(l.label) LIKE '%meta%platforms%'
        OR lower(l.label) LIKE '%meta%reklamy%'
      )
    ) AS is_marketing,
    bool_or(
      l.debit_account ~ '^518'
      AND (
        lower(l.label) LIKE '%lidet%'
        OR lower(l.label) LIKE '%leri s.r.o%'
        OR lower(l.label) LIKE '%zelina%'
        OR l.label ~ 'echovsk'
        OR l.label ~ 'ure.kov'
      )
    ) AS is_staff
  FROM lines l
  CROSS JOIN last_month lm
  WHERE l.debit_account ~ '^5'
    AND l.month_key = lm.month_key
  GROUP BY 1, 2
  HAVING ABS(SUM(l.amount_eur)) >= 0.5
  ORDER BY 3 DESC
),
totals AS (
  SELECT
    ROUND(SUM(total_revenue), 2) AS total_revenue,
    ROUND(SUM(cogs_journal), 2) AS cogs_journal,
    ROUND(SUM(cogs_estimated), 2) AS cogs_estimated,
    ROUND(SUM(cogs), 2) AS cogs,
    ROUND(SUM(gross_profit), 2) AS gross_profit,
    ROUND(SUM(total_opex), 2) AS total_opex,
    ROUND(SUM(contribution_margin), 2) AS contribution_margin,
    ROUND(SUM(marketing_spend), 2) AS marketing_spend,
    ROUND(SUM(staff_spend), 2) AS staff_spend
  FROM monthly
)
SELECT json_build_object(
  'meta', json_build_object(
    'year', (SELECT yr FROM params),
    'from', (SELECT d_from FROM year_bounds),
    'to', (SELECT d_to FROM year_bounds),
    'last_actual_month', (SELECT substring(month_key from 6 for 2)::int FROM last_month),
    'last_month_key', (SELECT month_key FROM last_month),
    'note', 'P&L z denníka. COGS = 42 % čistých tržieb za tovar (nákup Orin). Staff = dodávatelia klasifikovaní podľa XLS ako mzdy. Chýbajú: mzdy (52x), odpisy (55x), daň z príjmov (59x).'
  ),
  'totals', (SELECT row_to_json(t) FROM totals t),
  'monthly', COALESCE(
    (SELECT json_agg(row_to_json(m) ORDER BY m.month_key) FROM monthly m),
    '[]'::json
  ),
  'topExpenses', COALESCE(
    (SELECT json_agg(row_to_json(te) ORDER BY te.amount_eur DESC) FROM top_expenses te),
    '[]'::json
  ),
  'topExpensesLastMonth', COALESCE(
    (SELECT json_agg(row_to_json(te) ORDER BY te.amount_eur DESC) FROM top_expenses_last_month te),
    '[]'::json
  )
);
$$;

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
    COALESCE(x.revenue_goods, 0) AS revenue_goods,
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
last_month AS (
  SELECT COALESCE(
    (SELECT month_key FROM actual_rows ORDER BY month_key DESC LIMIT 1),
    (SELECT yr FROM params)::text || '-01'
  ) AS month_key
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
),
top_expenses_last_month AS (
  SELECT
    e.supplier,
    e.account_prefix,
    ROUND(SUM(e.amount_eur), 2) AS amount_eur,
    COUNT(*)::int AS line_count,
    bool_or(e.is_marketing) AS is_marketing,
    bool_or(e.is_staff) AS is_staff
  FROM public.pnl_xls_expenses_monthly e
  CROSS JOIN last_month lm
  WHERE e.month_key = lm.month_key
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
    'last_month_key', (SELECT month_key FROM last_month),
    'note', 'Hodnoty prevzate priamo z XLS sheet-u Vysledky + rozpad nakladovych poloziek.'
  ),
  'totals', (SELECT row_to_json(t) FROM totals t),
  'monthly', COALESCE(
    (SELECT json_agg(
      json_build_object(
        'month_key', r.month_key,
        'revenue', r.revenue,
        'revenue_goods', r.revenue_goods,
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
  ),
  'topExpensesLastMonth', COALESCE(
    (SELECT json_agg(row_to_json(te) ORDER BY te.amount_eur DESC) FROM top_expenses_last_month te),
    '[]'::json
  )
);
$$;

REVOKE ALL ON FUNCTION public.get_pnl_dashboard(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pnl_dashboard(text) TO service_role;
REVOKE ALL ON FUNCTION public.get_pnl_xls_dashboard(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pnl_xls_dashboard(text) TO service_role;
