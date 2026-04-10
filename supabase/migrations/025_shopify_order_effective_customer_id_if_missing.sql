-- Ak bol projekt bez migrácie 016, chýba shopify_order_effective_customer_id a get_shopify_dashboard_mvp (024) zlyhá.
-- Idempotentné CREATE OR REPLACE; bez UPDATE shopify_orders (ten ostáva v 016).

CREATE OR REPLACE FUNCTION public.shopify_order_effective_customer_id(p_raw jsonb, p_customer_id bigint)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT COALESCE(
    p_customer_id,
    CASE
      WHEN p_raw IS NULL THEN NULL::bigint
      WHEN p_raw->'customer' IS NULL THEN NULL::bigint
      WHEN jsonb_typeof(p_raw->'customer') <> 'object' THEN NULL::bigint
      ELSE (substring(p_raw->'customer'->>'id' from '/([0-9]+)$'))::bigint
    END
  );
$$;

COMMENT ON FUNCTION public.shopify_order_effective_customer_id(jsonb, bigint) IS 'Shopify order customer legacy id: column or tail of raw_json.customer.id (GID)';

REVOKE ALL ON FUNCTION public.shopify_order_effective_customer_id(jsonb, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shopify_order_effective_customer_id(jsonb, bigint) TO service_role;
