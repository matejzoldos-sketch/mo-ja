-- UTM / customer journey attribution from Shopify customerJourneySummary (last-touch + landing/referrer).

ALTER TABLE shopify_orders
  ADD COLUMN IF NOT EXISTS utm_attribution_ready BOOLEAN,
  ADD COLUMN IF NOT EXISTS utm_source TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS utm_content TEXT,
  ADD COLUMN IF NOT EXISTS utm_term TEXT,
  ADD COLUMN IF NOT EXISTS utm_landing_page TEXT,
  ADD COLUMN IF NOT EXISTS utm_referrer_url TEXT,
  ADD COLUMN IF NOT EXISTS utm_visit_source TEXT;

CREATE INDEX IF NOT EXISTS idx_shopify_orders_utm_source
  ON shopify_orders (utm_source)
  WHERE utm_source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shopify_orders_utm_campaign
  ON shopify_orders (utm_campaign)
  WHERE utm_campaign IS NOT NULL;

COMMENT ON COLUMN shopify_orders.utm_attribution_ready IS
  'Shopify customerJourneySummary.ready — false until attribution sessions are computed.';
COMMENT ON COLUMN shopify_orders.utm_source IS
  'Last-touch UTM source (utmParameters.source), fallback visit.source from customerJourneySummary.lastVisit.';
COMMENT ON COLUMN shopify_orders.utm_medium IS 'Last-touch UTM medium.';
COMMENT ON COLUMN shopify_orders.utm_campaign IS 'Last-touch UTM campaign.';
COMMENT ON COLUMN shopify_orders.utm_content IS 'Last-touch UTM content.';
COMMENT ON COLUMN shopify_orders.utm_term IS 'Last-touch UTM term.';
COMMENT ON COLUMN shopify_orders.utm_landing_page IS 'Last-touch landing page URL before order.';
COMMENT ON COLUMN shopify_orders.utm_referrer_url IS 'Last-touch referrer URL before order.';
COMMENT ON COLUMN shopify_orders.utm_visit_source IS 'Shopify visit source label (e.g. Google, Facebook, direct).';
