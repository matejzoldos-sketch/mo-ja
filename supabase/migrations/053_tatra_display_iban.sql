-- Čitateľný názov účtu (IBAN alebo vlastný text). Sync doplní z API ak ho banka pošle; inak UPDATE v Table Editor.

ALTER TABLE tatra_account_balances
  ADD COLUMN IF NOT EXISTS display_iban TEXT;

COMMENT ON COLUMN tatra_account_balances.display_iban IS
  'IBAN alebo vlastný popis pre dashboard. Dopln ručne v Table Editor, ak API posiela len UUID. Sync zachová ručnú hodnotu, kým API nepošle vlastné IBAN.';

DROP VIEW IF EXISTS tatra_cashflow_dashboard;

CREATE VIEW tatra_cashflow_dashboard AS
WITH local_today AS (
  SELECT (current_timestamp AT TIME ZONE 'Europe/Bratislava')::date AS d
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
  FROM tatra_transactions t
  CROSS JOIN month_bounds mb
  WHERE t.booking_date >= mb.ms
    AND t.booking_date <= mb.today
  GROUP BY t.account_iban
),
accts AS (
  SELECT account_iban FROM tatra_account_balances
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
  COALESCE(m.credit_mtd, 0::numeric) AS credit_mtd,
  COALESCE(m.debit_mtd_abs, 0::numeric) AS debit_mtd_abs,
  COALESCE(m.net_mtd, 0::numeric) AS net_mtd
FROM accts a
LEFT JOIN tatra_account_balances b ON b.account_iban = a.account_iban
LEFT JOIN mtd m ON m.account_iban = a.account_iban;

COMMENT ON VIEW tatra_cashflow_dashboard IS 'Zostatok + display_iban / account_label; MTD z tatra_transactions (Europe/Bratislava).';

GRANT SELECT ON tatra_cashflow_dashboard TO anon, authenticated, service_role;
