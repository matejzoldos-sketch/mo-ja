-- P&L (contribution margin) dashboard from accounting journal
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
    COALESCE(NULLIF(trim(j.partner_name), ''), NULLIF(trim(j.company_name), ''), '?') AS label
  FROM accounting_journal_lines j
  CROSS JOIN year_bounds yb
  WHERE j.entry_date >= yb.d_from
    AND j.entry_date <= yb.d_to
),

-- Revenue: credit side class 6
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

-- COGS: debit 504
cogs_monthly AS (
  SELECT
    l.month_key,
    ROUND(SUM(l.amount_eur), 2) AS cogs
  FROM lines l
  WHERE l.debit_account ~ '^504'
  GROUP BY 1
),

-- Expenses by category: debit class 5 (excl. 504 = COGS)
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

-- Marketing subset of 518
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

-- All months present
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
    ROUND(COALESCE(r.sales_goods, 0) * 0.495, 2) AS cogs_estimated,
    GREATEST(COALESCE(c.cogs, 0), ROUND(COALESCE(r.sales_goods, 0) * 0.495, 2)) AS cogs,
    (COALESCE(r.total_revenue, 0) - GREATEST(COALESCE(c.cogs, 0), ROUND(COALESCE(r.sales_goods, 0) * 0.495, 2))) AS gross_profit,
    COALESCE(e.material, 0) AS material,
    COALESCE(e.representation, 0) AS representation,
    COALESCE(e.services, 0) AS services,
    COALESCE(e.taxes_fees, 0) AS taxes_fees,
    COALESCE(e.other_operating, 0) AS other_operating,
    COALESCE(e.financial, 0) AS financial,
    COALESCE(e.total_opex, 0) AS total_opex,
    COALESCE(mk.marketing_spend, 0) AS marketing_spend,
    (COALESCE(r.total_revenue, 0) - GREATEST(COALESCE(c.cogs, 0), ROUND(COALESCE(r.sales_goods, 0) * 0.495, 2)) - COALESCE(e.total_opex, 0)) AS contribution_margin
  FROM months m
  LEFT JOIN revenue_monthly r ON r.month_key = m.month_key
  LEFT JOIN cogs_monthly c ON c.month_key = m.month_key
  LEFT JOIN expense_monthly e ON e.month_key = m.month_key
  LEFT JOIN marketing_monthly mk ON mk.month_key = m.month_key
),

-- All expenses by supplier
top_expenses AS (
  SELECT
    l.label AS supplier,
    LEFT(l.debit_account, 3) AS account_prefix,
    ROUND(SUM(l.amount_eur), 2) AS amount_eur,
    COUNT(*)::int AS line_count,
    bool_or(
      l.debit_account ~ '^518|^5015'
      AND public.classify_journal_marketing_expense(l.line_text, l.label, l.label, l.debit_account) IN ('fees', 'ads_skip')
    ) AS is_marketing
  FROM lines l
  WHERE l.debit_account ~ '^5'
  GROUP BY 1, 2
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
    ROUND(SUM(marketing_spend), 2) AS marketing_spend
  FROM monthly
)

SELECT json_build_object(
  'meta', json_build_object(
    'year', (SELECT yr FROM params),
    'from', (SELECT d_from FROM year_bounds),
    'to', (SELECT d_to FROM year_bounds),
    'note', 'Čiastočný P&L z účtovného denníka. COGS odhadnuté na 49,5 % tržieb za tovar (marža ~50 % podľa produktovej kalkulácie). Chýbajú: mzdy (52x), odpisy (55x), daň z príjmov (59x).'
  ),
  'totals', (SELECT row_to_json(t) FROM totals t),
  'monthly', COALESCE(
    (SELECT json_agg(row_to_json(m) ORDER BY m.month_key) FROM monthly m),
    '[]'::json
  ),
  'topExpenses', COALESCE(
    (SELECT json_agg(row_to_json(te) ORDER BY te.amount_eur DESC) FROM top_expenses te),
    '[]'::json
  )
);
$$;

COMMENT ON FUNCTION public.get_pnl_dashboard(text) IS
  'Monthly P&L (contribution margin) from accounting journal lines.';

REVOKE ALL ON FUNCTION public.get_pnl_dashboard(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pnl_dashboard(text) TO service_role;
