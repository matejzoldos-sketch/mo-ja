-- Meta Ads Manager export: denné metriky po kampani (CSV import).

CREATE TABLE IF NOT EXISTS public.meta_ads_campaign_daily (
  report_date date NOT NULL,
  campaign_name text NOT NULL,
  delivery_status text,
  results numeric,
  result_indicator text,
  cost_per_result numeric,
  ad_set_budget text,
  ad_set_budget_type text,
  spend_eur numeric NOT NULL DEFAULT 0,
  impressions bigint NOT NULL DEFAULT 0,
  reach bigint NOT NULL DEFAULT 0,
  campaign_end text,
  attribution_setting text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_date, campaign_name)
);

CREATE INDEX IF NOT EXISTS meta_ads_campaign_daily_campaign_name_idx
  ON public.meta_ads_campaign_daily (campaign_name);

CREATE INDEX IF NOT EXISTS meta_ads_campaign_daily_report_date_idx
  ON public.meta_ads_campaign_daily (report_date);

CREATE INDEX IF NOT EXISTS meta_ads_campaign_daily_year_idx
  ON public.meta_ads_campaign_daily ((EXTRACT(year FROM report_date)));

ALTER TABLE public.meta_ads_campaign_daily ENABLE ROW LEVEL SECURITY;

-- Frontend ide cez RPC (service role), ale necháme RLS čitateľné pre prípad exportov.
DROP POLICY IF EXISTS "Public read meta_ads_campaign_daily" ON public.meta_ads_campaign_daily;
CREATE POLICY "Public read meta_ads_campaign_daily"
  ON public.meta_ads_campaign_daily
  FOR SELECT
  USING (true);

GRANT SELECT ON public.meta_ads_campaign_daily TO anon, authenticated, service_role;

