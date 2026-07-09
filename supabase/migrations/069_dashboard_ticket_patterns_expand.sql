-- Broaden ticket detection for dashboard exclusions and explicit ticket filter.

CREATE OR REPLACE FUNCTION public.shopify_line_item_is_listok(
  p_sku text,
  p_title text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT
    COALESCE(p_title, '') ILIKE '%lístk%'
    OR COALESCE(p_title, '') ILIKE '%listk%'
    OR COALESCE(p_title, '') ILIKE '%vstupen%'
    OR COALESCE(p_title, '') ILIKE '%ticket%'
    OR COALESCE(p_sku, '') ILIKE '%lístk%'
    OR COALESCE(p_sku, '') ILIKE '%listk%'
    OR COALESCE(p_sku, '') ILIKE '%vstupen%'
    OR COALESCE(p_sku, '') ILIKE '%ticket%';
$$;

REVOKE ALL ON FUNCTION public.shopify_line_item_is_listok(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shopify_line_item_is_listok(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.shopify_line_item_excluded_from_predaj_dashboard(
  p_sku text,
  p_title text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT
    public.shopify_line_item_is_listok(p_sku, p_title)
    OR (
      (
        COALESCE(p_title, '') ILIKE '%bez%chaos%'
        OR COALESCE(p_title, '') ILIKE '%bez chaos%'
      )
      AND (
        (COALESCE(p_title, '') ILIKE '%moja%' AND COALESCE(p_title, '') ILIKE '%fáza%')
        OR (COALESCE(p_title, '') ILIKE '%moja%' AND COALESCE(p_title, '') ILIKE '%faza%')
      )
    )
    OR (
      (
        COALESCE(p_sku, '') ILIKE '%bez%chaos%'
        OR COALESCE(p_sku, '') ILIKE '%bez chaos%'
      )
      AND (
        (COALESCE(p_sku, '') ILIKE '%moja%' AND COALESCE(p_sku, '') ILIKE '%fáza%')
        OR (COALESCE(p_sku, '') ILIKE '%moja%' AND COALESCE(p_sku, '') ILIKE '%faza%')
      )
    );
$$;

REVOKE ALL ON FUNCTION public.shopify_line_item_excluded_from_predaj_dashboard(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shopify_line_item_excluded_from_predaj_dashboard(text, text) TO service_role;

COMMENT ON FUNCTION public.shopify_line_item_is_listok(text, text) IS
  'Ticket/event line detection for dashboard filters: listok/listok, vstupenka, ticket in SKU or title.';

COMMENT ON FUNCTION public.shopify_line_item_excluded_from_predaj_dashboard(text, text) IS
  'Predaj dashboard: vylúčenie ticket/event položiek a produktu MOJA fáza bez chaosu (SKU alebo názov položky).';

NOTIFY pgrst, 'reload schema';
