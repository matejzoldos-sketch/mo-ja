-- Meta Ads: store website purchase conversion value for real Meta ROAS.

ALTER TABLE public.meta_ads_campaign_daily
  ADD COLUMN IF NOT EXISTS purchase_value_eur numeric,
  ADD COLUMN IF NOT EXISTS purchases_count numeric;

COMMENT ON COLUMN public.meta_ads_campaign_daily.purchase_value_eur IS
  'Website / purchases conversion value from Meta Ads export (EUR).';
COMMENT ON COLUMN public.meta_ads_campaign_daily.purchases_count IS
  'Purchases count column from Meta Ads export (Nákupy), when present.';
