-- Shopify order tax / DPH from Admin GraphQL (taxesIncluded, totalTaxSet, taxLines).

ALTER TABLE shopify_orders
  ADD COLUMN IF NOT EXISTS taxes_included BOOLEAN,
  ADD COLUMN IF NOT EXISTS total_tax NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS total_price_net NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(8, 6),
  ADD COLUMN IF NOT EXISTS tax_title TEXT;

COMMENT ON COLUMN shopify_orders.taxes_included IS
  'Shopify Order.taxesIncluded — true if line/subtotal prices include tax.';
COMMENT ON COLUMN shopify_orders.total_tax IS
  'Shopify Order.currentTotalTaxSet (after returns/refunds); DPH suma.';
COMMENT ON COLUMN shopify_orders.total_price_net IS
  'total_price − total_tax (tržba bez DPH). NULL ak tax ešte nebol syncnutý.';
COMMENT ON COLUMN shopify_orders.tax_rate IS
  'Dominantná sadzba z currentTaxLines.rate (napr. 0.19 = 19 %).';
COMMENT ON COLUMN shopify_orders.tax_title IS
  'Názov dominantnej tax line (napr. SK VAT).';
