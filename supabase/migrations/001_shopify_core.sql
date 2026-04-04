-- Shopify → Supabase: orders, line items, inventory, locations.
-- Service role bypasses RLS; anon/authenticated have no policies (no direct client reads).

CREATE TABLE IF NOT EXISTS shopify_locations (
  id              BIGINT NOT NULL PRIMARY KEY,
  name            TEXT,
  is_active       BOOLEAN,
  raw_json        JSONB NOT NULL DEFAULT '{}',
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shopify_locations_active ON shopify_locations (is_active);

CREATE TABLE IF NOT EXISTS shopify_orders (
  id                      BIGINT NOT NULL PRIMARY KEY,
  shopify_gid             TEXT NOT NULL,
  name                    TEXT,
  created_at              TIMESTAMPTZ NOT NULL,
  updated_at              TIMESTAMPTZ NOT NULL,
  financial_status        TEXT,
  fulfillment_status      TEXT,
  currency                TEXT,
  total_price             NUMERIC(18, 4),
  subtotal_price          NUMERIC(18, 4),
  raw_json                JSONB NOT NULL,
  fetched_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shopify_orders_created ON shopify_orders (created_at);
CREATE INDEX IF NOT EXISTS idx_shopify_orders_updated ON shopify_orders (updated_at);

CREATE TABLE IF NOT EXISTS shopify_order_line_items (
  order_id            BIGINT NOT NULL REFERENCES shopify_orders (id) ON DELETE CASCADE,
  line_item_id        BIGINT NOT NULL,
  title               TEXT,
  sku                 TEXT,
  quantity            INTEGER,
  variant_id          BIGINT,
  inventory_item_id   BIGINT,
  unit_price          NUMERIC(18, 4),
  raw_json            JSONB NOT NULL,
  fetched_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, line_item_id)
);

CREATE INDEX IF NOT EXISTS idx_shopify_line_items_variant ON shopify_order_line_items (variant_id);
CREATE INDEX IF NOT EXISTS idx_shopify_line_items_inv_item ON shopify_order_line_items (inventory_item_id);

CREATE TABLE IF NOT EXISTS shopify_inventory_levels (
  inventory_item_id   BIGINT NOT NULL,
  location_id         BIGINT NOT NULL REFERENCES shopify_locations (id) ON DELETE CASCADE,
  available           INTEGER NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ,
  raw_json            JSONB NOT NULL,
  fetched_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (inventory_item_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_shopify_inv_levels_location ON shopify_inventory_levels (location_id);

CREATE TABLE IF NOT EXISTS shopify_sync_state (
  resource        TEXT NOT NULL PRIMARY KEY,
  last_success_at TIMESTAMPTZ,
  meta            JSONB NOT NULL DEFAULT '{}'
);

ALTER TABLE shopify_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_order_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_inventory_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_sync_state ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE shopify_orders IS 'Shopify orders; raw_json = full API node';
COMMENT ON TABLE shopify_order_line_items IS 'Line items per order';
COMMENT ON TABLE shopify_inventory_levels IS 'Available qty per inventory_item_id × location_id';
COMMENT ON TABLE shopify_locations IS 'Shopify locations cache';
