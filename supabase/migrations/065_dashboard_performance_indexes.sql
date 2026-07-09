-- Performance indexes for sales dashboard RPCs.

CREATE INDEX IF NOT EXISTS idx_shopify_orders_paid_created
  ON public.shopify_orders (created_at)
  WHERE UPPER(REPLACE(TRIM(COALESCE(financial_status, '')), ' ', '_')) IN (
    'PAID',
    'PARTIALLY_PAID',
    'PARTIALLY_REFUNDED'
  );

CREATE INDEX IF NOT EXISTS idx_shopify_orders_paid_returning_key_created
  ON public.shopify_orders (
    public.shopify_order_returning_group_key(raw_json, customer_id, customer_email),
    created_at
  )
  WHERE UPPER(REPLACE(TRIM(COALESCE(financial_status, '')), ' ', '_')) IN (
    'PAID',
    'PARTIALLY_PAID',
    'PARTIALLY_REFUNDED'
  )
    AND public.shopify_order_returning_group_key(raw_json, customer_id, customer_email) IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shopify_orders_paid_effective_customer_created
  ON public.shopify_orders (
    public.shopify_order_effective_customer_id(raw_json, customer_id),
    created_at
  )
  WHERE UPPER(REPLACE(TRIM(COALESCE(financial_status, '')), ' ', '_')) IN (
    'PAID',
    'PARTIALLY_PAID',
    'PARTIALLY_REFUNDED'
  )
    AND public.shopify_order_effective_customer_id(raw_json, customer_id) IS NOT NULL;

NOTIFY pgrst, 'reload schema';
