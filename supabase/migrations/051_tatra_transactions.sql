-- Tatra banka Premium API – Účty (AIS): uložené pohyby po synchronizácii.

CREATE TABLE IF NOT EXISTS tatra_transactions (
  external_id     TEXT NOT NULL,
  account_iban    TEXT NOT NULL,
  booking_date    DATE,
  value_date      DATE,
  amount          NUMERIC(18, 2),
  currency        TEXT NOT NULL DEFAULT 'EUR',
  creditor_name   TEXT,
  debtor_name     TEXT,
  creditor_iban   TEXT,
  debtor_iban     TEXT,
  remittance_info TEXT,
  raw_json        JSONB NOT NULL,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (external_id)
);

CREATE INDEX IF NOT EXISTS idx_tatra_txn_account_booking
  ON tatra_transactions (account_iban, booking_date DESC);

CREATE INDEX IF NOT EXISTS idx_tatra_txn_booking
  ON tatra_transactions (booking_date DESC);

ALTER TABLE tatra_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read tatra_transactions"
  ON tatra_transactions FOR SELECT USING (true);

GRANT SELECT ON tatra_transactions TO anon, authenticated, service_role;
