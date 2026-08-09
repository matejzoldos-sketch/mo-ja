-- Meta Ads attribution split: 7d click vs 1d view purchase values.

ALTER TABLE public.meta_ads_campaign_daily
  ADD COLUMN IF NOT EXISTS purchase_value_7d_click_eur numeric,
  ADD COLUMN IF NOT EXISTS purchase_value_1d_view_eur numeric;

COMMENT ON COLUMN public.meta_ads_campaign_daily.purchase_value_7d_click_eur IS
  'Purchase conversion value with 7-day click attribution window (EUR).';
COMMENT ON COLUMN public.meta_ads_campaign_daily.purchase_value_1d_view_eur IS
  'Purchase conversion value with 1-day view attribution window (EUR).';
