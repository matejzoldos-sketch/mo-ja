-- Lightweight RPC for Predaj monthly new vs returning chart (avoids full MVP timeout).

CREATE OR REPLACE FUNCTION public.get_shopify_monthly_new_vs_returning_dashboard(
  p_range text DEFAULT '365d'::text,
  p_kpi_product text DEFAULT NULL::text,
  p_month text DEFAULT NULL::text,
  p_year text DEFAULT NULL::text
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_tz CONSTANT text := 'Europe/Bratislava';
  v_from date;
  v_to date;
  v_kpi_prod text;
BEGIN
  SELECT b.d_from, b.d_to
  INTO v_from, v_to
  FROM public.shopify_dashboard_date_bounds(p_range, p_month, p_year) b;

  v_kpi_prod := lower(nullif(trim(coalesce(p_kpi_product, '')), ''));
  IF v_kpi_prod = '' OR v_kpi_prod = 'all' THEN
    v_kpi_prod := NULL;
  END IF;
  IF v_kpi_prod IS NOT NULL AND v_kpi_prod NOT IN ('moja_phase_bez', 'moja_phase_plus', 'listky') THEN
    RAISE EXCEPTION 'invalid p_kpi_product: % (allowed: all, moja_phase_bez, moja_phase_plus, listky)', p_kpi_product;
  END IF;

  RETURN public.shopify_dashboard_monthly_new_vs_returning(
    (v_from::timestamp AT TIME ZONE v_tz),
    ((v_to + 1)::timestamp AT TIME ZONE v_tz),
    v_from,
    v_to,
    v_tz,
    v_kpi_prod
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_shopify_monthly_new_vs_returning_dashboard(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shopify_monthly_new_vs_returning_dashboard(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_shopify_monthly_new_vs_returning_dashboard(text, text, text, text) TO authenticated, anon;

GRANT EXECUTE ON FUNCTION public.shopify_dashboard_monthly_new_vs_returning(timestamptz, timestamptz, date, date, text, text) TO service_role;

COMMENT ON FUNCTION public.get_shopify_monthly_new_vs_returning_dashboard(text, text, text, text) IS
  'Predaj chart: monthlyNewVsReturning payload (revenue + customer counts) without full MVP.';
