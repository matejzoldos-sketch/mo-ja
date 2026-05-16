-- Zostatky účtov z Tatra Premium API (AIS) + pohľad pre dashboard (MTD z tatra_transactions).

CREATE TABLE IF NOT EXISTS tatra_account_balances (
  account_iban    TEXT PRIMARY KEY,
  resource_id     TEXT,
  balance         NUMERIC(18, 2) NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'EUR',
  balance_type    TEXT,
  reference_date  DATE,
  raw_balances    JSONB,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tatra_bal_fetched ON tatra_account_balances (fetched_at DESC);

ALTER TABLE tatra_account_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read tatra_account_balances"
  ON tatra_account_balances FOR SELECT USING (true);

GRANT SELECT ON tatra_account_balances TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW tatra_cashflow_dashboard AS
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
  b.resource_id,
  b.balance,
  b.currency,
  b.balance_type,
  b.reference_date,
  b.fetched_at AS balance_fetched_at,
  COALESCE(m.credit_mtd, 0::numeric) AS credit_mtd,
  COALESCE(m.debit_mtd_abs, 0::numeric) AS debit_mtd_abs,
  COALESCE(m.net_mtd, 0::numeric) AS net_mtd
FROM accts a
LEFT JOIN tatra_account_balances b ON b.account_iban = a.account_iban
LEFT JOIN mtd m ON m.account_iban = a.account_iban;

COMMENT ON VIEW tatra_cashflow_dashboard IS 'Zostatok z tatra_account_balances + kredit/debet/čistý MTD z tatra_transactions (Europe/Bratislava).';

GRANT SELECT ON tatra_cashflow_dashboard TO anon, authenticated, service_role;
