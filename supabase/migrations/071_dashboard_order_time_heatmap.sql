-- Heatmap: kedy prichádzajú objednávky podľa dňa v týždni a hodiny.

CREATE OR REPLACE FUNCTION public.get_shopify_order_time_heatmap(
  p_range text DEFAULT 'ytd',
  p_kpi_product text DEFAULT NULL,
  p_month text DEFAULT NULL,
  p_year text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz CONSTANT text := 'Europe/Bratislava';
  v_from date;
  v_to date;
  v_norm text;
  v_ts_from timestamptz;
  v_ts_to_excl timestamptz;
  v_kpi_prod text;
  v_cells json;
  v_max_orders int;
BEGIN
  SELECT b.d_from, b.d_to, b.range_key
  INTO v_from, v_to, v_norm
  FROM public.shopify_dashboard_date_bounds(p_range, p_month, p_year) b;

  v_ts_from := (v_from::timestamp AT TIME ZONE v_tz);
  v_ts_to_excl := ((v_to + 1)::timestamp AT TIME ZONE v_tz);

  v_kpi_prod := lower(nullif(trim(coalesce(p_kpi_product, '')), ''));
  IF v_kpi_prod = '' OR v_kpi_prod = 'all' THEN
    v_kpi_prod := NULL;
  END IF;
  IF v_kpi_prod IS NOT NULL AND v_kpi_prod NOT IN ('moja_phase_bez', 'moja_phase_plus', 'listky') THEN
    RAISE EXCEPTION 'invalid p_kpi_product: % (allowed: all, moja_phase_bez, moja_phase_plus, listky)', p_kpi_product;
  END IF;

  WITH hours AS (
    SELECT generate_series(0, 23) AS hour
  ),
  days AS (
    SELECT generate_series(1, 7) AS dow
  ),
  filtered_orders AS (
    SELECT
      EXTRACT(ISODOW FROM (o.created_at AT TIME ZONE v_tz))::int AS dow,
      EXTRACT(HOUR FROM (o.created_at AT TIME ZONE v_tz))::int AS hour
    FROM shopify_orders o
    WHERE o.created_at >= v_ts_from
      AND o.created_at < v_ts_to_excl
      AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
        'PAID',
        'PARTIALLY_PAID',
        'PARTIALLY_REFUNDED'
      )
      AND EXISTS (
        SELECT 1
        FROM shopify_order_line_items li_hp
        WHERE li_hp.order_id = o.id
          AND public.shopify_line_item_included_for_dashboard_filter(li_hp.sku, li_hp.title, v_kpi_prod)
      )
  ),
  agg AS (
    SELECT dow, hour, COUNT(*)::int AS orders
    FROM filtered_orders
    GROUP BY 1, 2
  ),
  grid AS (
    SELECT
      d.dow,
      h.hour,
      COALESCE(a.orders, 0) AS orders
    FROM days d
    CROSS JOIN hours h
    LEFT JOIN agg a
      ON a.dow = d.dow
     AND a.hour = h.hour
    ORDER BY d.dow, h.hour
  )
  SELECT
    COALESCE(
      json_agg(
        json_build_object(
          'dow', g.dow,
          'hour', g.hour,
          'orders', g.orders
        )
        ORDER BY g.dow, g.hour
      ),
      '[]'::json
    ),
    COALESCE(MAX(g.orders), 0)
  INTO v_cells, v_max_orders
  FROM grid g;

  RETURN json_build_object(
    'timezone', v_tz,
    'range', v_norm,
    'days', json_build_array('Po', 'Ut', 'St', 'Št', 'Pi', 'So', 'Ne'),
    'hours', (
      SELECT json_agg(h.hour ORDER BY h.hour)
      FROM generate_series(0, 23) AS h(hour)
    ),
    'maxOrders', COALESCE(v_max_orders, 0),
    'cells', COALESCE(v_cells, '[]'::json)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_shopify_order_time_heatmap(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shopify_order_time_heatmap(text, text, text, text) TO service_role;

COMMENT ON FUNCTION public.get_shopify_order_time_heatmap(text, text, text, text) IS
  'Heatmap času objednávok podľa dňa v týždni a hodiny v Europe/Bratislava pre dashboard predaja.';

NOTIFY pgrst, 'reload schema';
