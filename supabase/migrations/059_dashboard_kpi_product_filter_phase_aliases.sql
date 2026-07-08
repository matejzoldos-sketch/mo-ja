-- KPI produktový filter: zachytiť aj nové Shopify aliasy PHASE / PHASE PLUS a SKU PH-* / PH+*.

CREATE OR REPLACE FUNCTION public.shopify_line_matches_kpi_product_filter(
  p_sku text,
  p_title text,
  p_filter text
)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public
AS $$
  WITH hay AS (
    SELECT lower(coalesce(trim(p_title), '') || ' ' || coalesce(trim(p_sku), '')) AS v
  )
  SELECT
    p_filter IS NULL
    OR (
      p_filter = 'moja_phase_bez'
      AND (
        (
          EXISTS (
            SELECT 1
            FROM hay h
            WHERE h.v LIKE '%moja phase%'
              AND h.v LIKE '%bez%fytoestro%'
              AND h.v NOT LIKE '%phase+%'
          )
        )
        OR EXISTS (
          SELECT 1
          FROM hay h
          WHERE lower(trim(coalesce(p_title, ''))) = 'phase'
            OR h.v LIKE 'ph-b1%'
            OR h.v LIKE '% ph-b1%'
        )
      )
    )
    OR (
      p_filter = 'moja_phase_plus'
      AND (
        (
          EXISTS (
            SELECT 1
            FROM hay h
            WHERE h.v LIKE '%moja phase+%'
              AND h.v LIKE '%fytoestro%'
          )
        )
        OR EXISTS (
          SELECT 1
          FROM hay h
          WHERE h.v LIKE '%phase plus%'
            OR h.v LIKE '%phase+%'
            OR h.v LIKE 'ph+%'
            OR h.v LIKE '% ph+%'
        )
      )
    );
$$;

REVOKE ALL ON FUNCTION public.shopify_line_matches_kpi_product_filter(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shopify_line_matches_kpi_product_filter(text, text, text) TO service_role;

COMMENT ON FUNCTION public.shopify_line_matches_kpi_product_filter(text, text, text) IS 'Predaj KPI filter: NULL = all; moja_phase_bez / moja_phase_plus podľa title+sku, vrátane aliasov PHASE / PHASE PLUS a skladových SKU.';
