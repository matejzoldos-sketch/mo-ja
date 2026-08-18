-- MO-JA dashboard volá PostgREST výhradne so service_role (Next /api/*).
-- anon/authenticated nemajú mať SELECT ani EXECUTE na public schéme.

DROP POLICY IF EXISTS "Public read tatra_transactions" ON public.tatra_transactions;
DROP POLICY IF EXISTS "Public read tatra_account_balances" ON public.tatra_account_balances;
DROP POLICY IF EXISTS "Public read meta_ads_campaign_daily" ON public.meta_ads_campaign_daily;
DROP POLICY IF EXISTS "Public read accounting_journal_lines" ON public.accounting_journal_lines;
DROP POLICY IF EXISTS "Public read marketing_expense_map" ON public.marketing_expense_map;
DROP POLICY IF EXISTS "Public read shopify_sessions_daily" ON public.shopify_sessions_daily;

DROP VIEW IF EXISTS public.tatra_cashflow_dashboard;

CREATE VIEW public.tatra_cashflow_dashboard
WITH (security_invoker = true) AS
WITH local_today AS (
  SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Bratislava')::date AS d
),
month_bounds AS (
  SELECT date_trunc('month', d)::date AS ms, d AS today
  FROM local_today
),
mtd AS (
  SELECT
    t.account_iban,
    SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0::numeric END) AS credit_mtd,
    SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0::numeric END) AS debit_mtd_abs,
    COALESCE(SUM(t.amount), 0::numeric) AS net_mtd
  FROM public.tatra_transactions t
  CROSS JOIN month_bounds mb
  WHERE t.booking_date >= mb.ms
    AND t.booking_date <= mb.today
  GROUP BY t.account_iban
),
accts AS (
  SELECT account_iban FROM public.tatra_account_balances
  UNION
  SELECT account_iban FROM mtd
)
SELECT
  a.account_iban,
  COALESCE(NULLIF(TRIM(b.display_iban), ''), a.account_iban) AS account_label,
  b.resource_id,
  b.balance,
  b.currency,
  b.balance_type,
  b.reference_date,
  b.fetched_at AS balance_fetched_at,
  b.display_iban,
  b.ref_balance_as_of,
  b.ref_balance_amount,
  COALESCE(m.credit_mtd, 0::numeric) AS credit_mtd,
  COALESCE(m.debit_mtd_abs, 0::numeric) AS debit_mtd_abs,
  COALESCE(m.net_mtd, 0::numeric) AS net_mtd
FROM accts a
LEFT JOIN public.tatra_account_balances b ON b.account_iban = a.account_iban
LEFT JOIN mtd m ON m.account_iban = a.account_iban;

COMMENT ON VIEW public.tatra_cashflow_dashboard IS
  'Cash flow: zostatok API, voliteľný BB ref., MTD; Europe/Bratislava. security_invoker.';

REVOKE USAGE ON SCHEMA public FROM PUBLIC;
REVOKE USAGE ON SCHEMA public FROM anon, authenticated;
GRANT USAGE ON SCHEMA public TO postgres, service_role;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, service_role;
GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO postgres, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO postgres, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;

NOTIFY pgrst, 'reload schema';
