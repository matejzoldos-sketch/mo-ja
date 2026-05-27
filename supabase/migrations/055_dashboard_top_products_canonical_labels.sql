-- Zlúčenie aliasov produktov (PHASE / PHASE PLUS / MOJA Phase*) do kanonických názvov pre grafy.

CREATE OR REPLACE FUNCTION public.shopify_product_display_label(
  p_sku text,
  p_title text
)
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public
AS $$
  WITH hay AS (
    SELECT lower(coalesce(trim(p_title), '') || ' ' || coalesce(trim(p_sku), '')) AS v
  )
  SELECT
    CASE
      WHEN public.shopify_line_matches_kpi_product_filter(p_sku, p_title, 'moja_phase_plus')
        OR EXISTS (
          SELECT 1
          FROM hay h
          WHERE h.v LIKE '%phase plus%'
            OR h.v LIKE '%phase+%'
            OR h.v LIKE 'ph+%'
            OR h.v LIKE '% ph+%'
        )
      THEN 'MOJA Phase+ s fytoestrogénmi'
      WHEN public.shopify_line_matches_kpi_product_filter(p_sku, p_title, 'moja_phase_bez')
        OR EXISTS (
          SELECT 1
          FROM hay h
          WHERE lower(trim(coalesce(p_title, ''))) = 'phase'
            OR h.v LIKE 'ph-b1%'
            OR h.v LIKE '% ph-b1%'
        )
      THEN 'MOJA Phase bez fytoestrogénov'
      ELSE COALESCE(
        NULLIF(TRIM(p_title), ''),
        NULLIF(TRIM(p_sku), ''),
        '—'
      )
    END;
$$;

REVOKE ALL ON FUNCTION public.shopify_product_display_label(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shopify_product_display_label(text, text) TO service_role;

COMMENT ON FUNCTION public.shopify_product_display_label(text, text) IS 'Kanonický názov produktu pre grafy: zlučuje MOJA Phase* a skladové aliasy PHASE / PHASE PLUS.';

CREATE OR REPLACE FUNCTION public.get_shopify_dashboard_mvp(p_range text DEFAULT 'ytd', p_kpi_product text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz CONSTANT text := 'Europe/Bratislava';
  v_today date;
  v_from date;
  v_to date;
  v_year int;
  v_ts_from timestamptz;
  v_ts_to_excl timestamptz;
  v_kpis json;
  v_daily json;
  v_top json;
  v_recent json;
  v_top_customers json;
  v_monthly_new_ret json;
  v_purchase_count_dist json;
  v_interval_hist json;
  v_norm text;
  v_kpi_prod text;
BEGIN
  v_norm := lower(trim(COALESCE(p_range, 'ytd')));
  IF v_norm NOT IN ('ytd', '30d', '90d', '365d') THEN
    RAISE EXCEPTION 'invalid p_range: % (allowed: ytd, 30d, 90d, 365d)', p_range;
  END IF;

  v_today := (CURRENT_TIMESTAMP AT TIME ZONE v_tz)::date;
  v_to := v_today;

  IF v_norm = 'ytd' THEN
    v_year := EXTRACT(YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE v_tz))::int;
    v_from := make_date(v_year, 1, 1);
  ELSIF v_norm = '30d' THEN
    v_from := v_today - 29;
  ELSIF v_norm = '90d' THEN
    v_from := v_today - 89;
  ELSE
    v_from := v_today - 364;
  END IF;

  v_ts_from := (v_from::timestamp AT TIME ZONE v_tz);
  v_ts_to_excl := ((v_to + 1)::timestamp AT TIME ZONE v_tz);

  v_kpi_prod := lower(nullif(trim(coalesce(p_kpi_product, '')), ''));
  IF v_kpi_prod = '' OR v_kpi_prod = 'all' THEN
    v_kpi_prod := NULL;
  END IF;
  IF v_kpi_prod IS NOT NULL AND v_kpi_prod NOT IN ('moja_phase_bez', 'moja_phase_plus') THEN
    RAISE EXCEPTION 'invalid p_kpi_product: % (allowed: all, moja_phase_bez, moja_phase_plus)', p_kpi_product;
  END IF;

  SELECT json_build_object(
    'revenue', a.revenue,
    'orders', a.orders,
    'aov', a.aov,
    'currency', a.currency,
    'returning_customers_pct', r.returning_customers_pct,
    'avg_units_per_order',
      CASE
        WHEN a.orders > 0 THEN ROUND(u.total_units / a.orders::numeric, 2)
        ELSE NULL::numeric
      END,
    'pct_orders_multi_sku',
      CASE
        WHEN a.orders > 0 THEN ROUND(100.0 * msku.cnt::numeric / a.orders::numeric, 1)
        ELSE NULL::numeric
      END,
    'avg_customer_ltv', ltv.avg_customer_ltv,
    'avg_units_per_unique_customer',
      CASE
        WHEN uc.cust_cnt > 0 THEN ROUND(uc.units_sum / uc.cust_cnt::numeric, 2)
        ELSE NULL::numeric
      END,
    'avg_days_first_to_second_purchase', fs.avg_days_first_to_second
  )
  INTO v_kpis
  FROM (
    SELECT
      COALESCE(SUM(ord_ps.product_line_revenue), 0)::numeric AS revenue,
      COUNT(*)::int AS orders,
      CASE
        WHEN COUNT(*) > 0 THEN ROUND((SUM(ord_ps.product_line_revenue) / COUNT(*))::numeric, 2)
        ELSE 0
      END AS aov,
      MAX(ord_ps.currency) AS currency
    FROM (
      SELECT o.id,
             o.currency,
             (
               SELECT COALESCE(SUM(li.quantity * COALESCE(li.unit_price, 0)), 0)::numeric
               FROM shopify_order_line_items li
               WHERE li.order_id = o.id
                 AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title) AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li.sku, li.title, v_kpi_prod))
             ) AS product_line_revenue
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
            AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li_hp.sku, li_hp.title)
            AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li_hp.sku, li_hp.title, v_kpi_prod))
        )
    ) ord_ps
  ) a
  CROSS JOIN LATERAL (
    SELECT COALESCE(SUM(li.quantity), 0)::numeric AS total_units
    FROM shopify_order_line_items li
    INNER JOIN shopify_orders o ON o.id = li.order_id
    WHERE o.created_at >= v_ts_from
      AND o.created_at < v_ts_to_excl
      AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
        'PAID',
        'PARTIALLY_PAID',
        'PARTIALLY_REFUNDED'
      )
      AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title) AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li.sku, li.title, v_kpi_prod))
  ) u
  CROSS JOIN LATERAL (
    SELECT COUNT(*)::int AS cnt
    FROM (
      SELECT li.order_id
      FROM shopify_order_line_items li
      INNER JOIN shopify_orders o ON o.id = li.order_id
      WHERE o.created_at >= v_ts_from
        AND o.created_at < v_ts_to_excl
        AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
          'PAID',
          'PARTIALLY_PAID',
          'PARTIALLY_REFUNDED'
        )
        AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title) AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li.sku, li.title, v_kpi_prod))
      GROUP BY li.order_id
      HAVING COUNT(DISTINCT COALESCE(
        NULLIF(TRIM(li.sku), ''),
        NULLIF(TRIM(li.title), ''),
        '—'
      )) > 1
    ) t
  ) msku
  CROSS JOIN LATERAL (
    SELECT
      CASE
        WHEN cw.cnt = 0 THEN NULL::numeric
        ELSE ROUND(100.0 * rw_ytd.cnt / cw.cnt, 1)
      END AS returning_customers_pct
    FROM (
      SELECT COUNT(DISTINCT public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email))::numeric AS cnt
      FROM shopify_orders o
      WHERE o.created_at >= v_ts_from
        AND o.created_at < v_ts_to_excl
        AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
          'PAID',
          'PARTIALLY_PAID',
          'PARTIALLY_REFUNDED'
        )
        AND public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM shopify_order_line_items li_hp
          WHERE li_hp.order_id = o.id
            AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li_hp.sku, li_hp.title)
            AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li_hp.sku, li_hp.title, v_kpi_prod))
        )
    ) cw
    CROSS JOIN LATERAL (
      SELECT COUNT(*)::numeric AS cnt
      FROM (
        SELECT public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) AS gk
        FROM shopify_orders o
        WHERE o.created_at >= v_ts_from
          AND o.created_at < v_ts_to_excl
          AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
            'PAID',
            'PARTIALLY_PAID',
            'PARTIALLY_REFUNDED'
          )
          AND public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) IS NOT NULL
          AND EXISTS (
          SELECT 1
          FROM shopify_order_line_items li_hp
          WHERE li_hp.order_id = o.id
            AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li_hp.sku, li_hp.title)
            AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li_hp.sku, li_hp.title, v_kpi_prod))
        )
        GROUP BY public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email)
        HAVING COUNT(*) >= 2
      ) t
    ) rw_ytd
  ) r
  CROSS JOIN LATERAL (
    SELECT (
      WITH win_gk AS (
        SELECT DISTINCT public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) AS gk
        FROM shopify_orders o
        WHERE o.created_at >= v_ts_from
          AND o.created_at < v_ts_to_excl
          AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
            'PAID',
            'PARTIALLY_PAID',
            'PARTIALLY_REFUNDED'
          )
          AND public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) IS NOT NULL
          AND EXISTS (
          SELECT 1
          FROM shopify_order_line_items li_hp
          WHERE li_hp.order_id = o.id
            AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li_hp.sku, li_hp.title)
            AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li_hp.sku, li_hp.title, v_kpi_prod))
        )
      ),
      ltv_by_gk AS (
        SELECT public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) AS gk,
               SUM(li.quantity * COALESCE(li.unit_price, 0))::numeric AS ltv_sum
        FROM shopify_orders o
        INNER JOIN shopify_order_line_items li ON li.order_id = o.id
        WHERE UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
            'PAID',
            'PARTIALLY_PAID',
            'PARTIALLY_REFUNDED'
          )
          AND public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) IS NOT NULL
          AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title) AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li.sku, li.title, v_kpi_prod))
        GROUP BY 1
      )
      SELECT ROUND(AVG(l.ltv_sum)::numeric, 2)
      FROM win_gk w
      INNER JOIN ltv_by_gk l ON l.gk = w.gk
    ) AS avg_customer_ltv
  ) ltv
  CROSS JOIN LATERAL (
    SELECT
      (
        SELECT COALESCE(SUM(li.quantity), 0)::numeric
        FROM shopify_order_line_items li
        INNER JOIN shopify_orders o ON o.id = li.order_id
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
            AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li_hp.sku, li_hp.title)
            AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li_hp.sku, li_hp.title, v_kpi_prod))
        )
          AND public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) IS NOT NULL
          AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title) AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li.sku, li.title, v_kpi_prod))
      ) AS units_sum,
      (
        SELECT COUNT(DISTINCT public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email))::int
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
            AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li_hp.sku, li_hp.title)
            AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li_hp.sku, li_hp.title, v_kpi_prod))
        )
          AND public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) IS NOT NULL
      ) AS cust_cnt
  ) uc
  CROSS JOIN LATERAL (
    SELECT ROUND(AVG((p.second_d - p.first_d)::numeric), 1) AS avg_days_first_to_second
    FROM (
      SELECT
        public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) AS gk,
        (array_agg((o.created_at AT TIME ZONE v_tz)::date ORDER BY o.created_at ASC, o.id ASC))[1] AS first_d,
        (array_agg((o.created_at AT TIME ZONE v_tz)::date ORDER BY o.created_at ASC, o.id ASC))[2] AS second_d
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
            AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li_hp.sku, li_hp.title)
            AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li_hp.sku, li_hp.title, v_kpi_prod))
        )
        AND public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) IS NOT NULL
      GROUP BY public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email)
      HAVING COUNT(*) >= 2
    ) p
    WHERE p.first_d IS NOT NULL
      AND p.second_d IS NOT NULL
      AND p.second_d >= p.first_d
  ) fs;

  WITH days AS (
    SELECT dd::date AS day
    FROM generate_series(v_from, v_to, '1 day'::interval) AS dd
  ),
  agg AS (
    SELECT (o.created_at AT TIME ZONE v_tz)::date AS day,
           COALESCE(SUM(li.quantity * COALESCE(li.unit_price, 0)), 0)::numeric AS revenue
    FROM shopify_order_line_items li
    INNER JOIN shopify_orders o ON o.id = li.order_id
    WHERE o.created_at >= v_ts_from
      AND o.created_at < v_ts_to_excl
      AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
        'PAID',
        'PARTIALLY_PAID',
        'PARTIALLY_REFUNDED'
      )
      AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title) AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li.sku, li.title, v_kpi_prod))
    GROUP BY 1
  )
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'date', days.day::text,
        'revenue', ROUND(COALESCE(agg.revenue, 0)::numeric, 2)
      )
      ORDER BY days.day
    ),
    '[]'::json
  )
  INTO v_daily
  FROM days
  LEFT JOIN agg ON agg.day = days.day;

  SELECT COALESCE(
    (
      SELECT json_agg(
        json_build_object(
          'label', s.label,
          'revenue', ROUND(s.revenue::numeric, 2),
          'units', s.units
        )
        ORDER BY s.revenue DESC
      )
      FROM (
        SELECT public.shopify_product_display_label(li.sku, li.title) AS label,
               SUM(li.quantity * COALESCE(li.unit_price, 0))::numeric AS revenue,
               SUM(li.quantity)::int AS units
        FROM shopify_order_line_items li
        INNER JOIN shopify_orders o ON o.id = li.order_id
        WHERE o.created_at >= v_ts_from
          AND o.created_at < v_ts_to_excl
          AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
            'PAID',
            'PARTIALLY_PAID',
            'PARTIALLY_REFUNDED'
          )
          AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title) AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li.sku, li.title, v_kpi_prod))
        GROUP BY 1
        ORDER BY revenue DESC
        LIMIT 5
      ) s
    ),
    '[]'::json
  )
  INTO v_top;

  SELECT COALESCE(
    (
      SELECT json_agg(
        json_build_object(
          'id', t.id,
          'name', t.name,
          'created_at', t.created_at_local,
          'financial_status', t.financial_status,
          'fulfillment_status', t.fulfillment_status,
          'customer_display_name', t.customer_display_name,
          'total_price', t.total_price,
          'currency', t.currency
        )
        ORDER BY
          CASE WHEN v_norm IN ('30d', '90d', '365d') THEN t.total_price::numeric END DESC NULLS LAST,
          t.sort_ts DESC
      )
      FROM (
        SELECT o.id,
               o.name,
               to_char(o.created_at AT TIME ZONE v_tz, 'YYYY-MM-DD HH24:MI') AS created_at_local,
               o.financial_status,
               o.fulfillment_status,
               o.customer_display_name,
               ROUND(
                 (
                   SELECT COALESCE(SUM(li.quantity * COALESCE(li.unit_price, 0)), 0)::numeric
                   FROM shopify_order_line_items li
                   WHERE li.order_id = o.id
                     AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title) AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li.sku, li.title, v_kpi_prod))
                 ),
                 2
               ) AS total_price,
               o.currency,
               o.created_at AS sort_ts
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
            AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li_hp.sku, li_hp.title)
            AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li_hp.sku, li_hp.title, v_kpi_prod))
        )
        ORDER BY
          CASE WHEN v_norm IN ('30d', '90d', '365d') THEN
            (
              SELECT COALESCE(SUM(li.quantity * COALESCE(li.unit_price, 0)), 0)::numeric
              FROM shopify_order_line_items li
              WHERE li.order_id = o.id
                AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title) AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li.sku, li.title, v_kpi_prod))
            )
          END DESC NULLS LAST,
          o.created_at DESC
        LIMIT 10
      ) t
    ),
    '[]'::json
  )
  INTO v_recent;

  SELECT COALESCE(
    (
      SELECT json_agg(
        json_build_object(
          'customer_id', x.customer_id,
          'orders', x.orders,
          'revenue', ROUND(x.revenue::numeric, 2),
          'currency', x.currency
        )
        ORDER BY x.revenue DESC
      )
      FROM (
        SELECT
          public.shopify_order_effective_customer_id(o.raw_json, o.customer_id) AS customer_id,
          COUNT(DISTINCT o.id)::int AS orders,
          SUM(li.quantity * COALESCE(li.unit_price, 0))::numeric AS revenue,
          MAX(o.currency) AS currency
        FROM shopify_orders o
        INNER JOIN shopify_order_line_items li ON li.order_id = o.id
        WHERE o.created_at >= v_ts_from
          AND o.created_at < v_ts_to_excl
          AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
            'PAID',
            'PARTIALLY_PAID',
            'PARTIALLY_REFUNDED'
          )
          AND public.shopify_order_effective_customer_id(o.raw_json, o.customer_id) IS NOT NULL
          AND EXISTS (
          SELECT 1
          FROM shopify_order_line_items li_hp
          WHERE li_hp.order_id = o.id
            AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li_hp.sku, li_hp.title)
            AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li_hp.sku, li_hp.title, v_kpi_prod))
        )
          AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title) AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li.sku, li.title, v_kpi_prod))
        GROUP BY 1
        ORDER BY revenue DESC
        LIMIT 10
      ) x
    ),
    '[]'::json
  )
  INTO v_top_customers;

  SELECT COALESCE(
    (
      WITH first_ord AS (
        SELECT DISTINCT ON (public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email))
          public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) AS gk,
          o.id AS first_order_id
        FROM shopify_orders o
        WHERE UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
            'PAID',
            'PARTIALLY_PAID',
            'PARTIALLY_REFUNDED'
          )
          AND public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM shopify_order_line_items li_hp
            WHERE li_hp.order_id = o.id
              AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li_hp.sku, li_hp.title)
              AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li_hp.sku, li_hp.title, v_kpi_prod))
          )
        ORDER BY 1, o.created_at ASC, o.id ASC
      ),
      win_ord AS (
        SELECT
          o.id,
          o.created_at,
          public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) AS gk,
          (
            SELECT COALESCE(SUM(li.quantity * COALESCE(li.unit_price, 0)), 0)::numeric
            FROM shopify_order_line_items li
            WHERE li.order_id = o.id
              AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title)
              AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li.sku, li.title, v_kpi_prod))
          ) AS rev
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
              AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li_hp.sku, li_hp.title)
              AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li_hp.sku, li_hp.title, v_kpi_prod))
          )
      ),
      win_class AS (
        SELECT
          date_trunc('month', (w.created_at AT TIME ZONE v_tz)::timestamp)::date AS m,
          CASE
            WHEN w.gk IS NULL THEN 'skip'
            WHEN fo.first_order_id IS NOT DISTINCT FROM w.id THEN 'new'
            ELSE 'returning'
          END AS seg,
          w.rev
        FROM win_ord w
        LEFT JOIN first_ord fo ON fo.gk = w.gk
        WHERE w.rev > 0
      ),
      agg AS (
        SELECT wc.m, wc.seg, SUM(wc.rev)::numeric AS s
        FROM win_class wc
        WHERE wc.seg <> 'skip'
        GROUP BY 1, 2
      ),
      months AS (
        SELECT (gs)::date AS m
        FROM generate_series(
          date_trunc('month', v_from::timestamp)::date,
          date_trunc('month', v_to::timestamp)::date,
          '1 month'::interval
        ) AS gs
      )
      SELECT json_build_object(
        'months',
        COALESCE(
          (SELECT json_agg(mm.m::text ORDER BY mm.m) FROM months mm),
          '[]'::json
        ),
        'newRevenue',
        COALESCE(
          (
            SELECT json_agg(ROUND(COALESCE(a.s, 0)::numeric, 2) ORDER BY mm.m)
            FROM months mm
            LEFT JOIN agg a ON a.m = mm.m AND a.seg = 'new'
          ),
          '[]'::json
        ),
        'returningRevenue',
        COALESCE(
          (
            SELECT json_agg(ROUND(COALESCE(a.s, 0)::numeric, 2) ORDER BY mm.m)
            FROM months mm
            LEFT JOIN agg a ON a.m = mm.m AND a.seg = 'returning'
          ),
          '[]'::json
        )
      )
    ),
    json_build_object(
      'months', '[]'::json,
      'newRevenue', '[]'::json,
      'returningRevenue', '[]'::json
    )
  )
  INTO v_monthly_new_ret;

  SELECT COALESCE(
    (
      WITH win_ord AS (
        SELECT
          o.id,
          public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) AS gk
        FROM shopify_orders o
        WHERE o.created_at >= v_ts_from
          AND o.created_at < v_ts_to_excl
          AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
            'PAID',
            'PARTIALLY_PAID',
            'PARTIALLY_REFUNDED'
          )
          AND public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM shopify_order_line_items li_hp
            WHERE li_hp.order_id = o.id
              AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li_hp.sku, li_hp.title)
              AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li_hp.sku, li_hp.title, v_kpi_prod))
          )
      ),
      per_gk AS (
        SELECT wo.gk, COUNT(*)::int AS n_orders
        FROM win_ord wo
        GROUP BY wo.gk
      ),
      bucketed AS (
        SELECT
          CASE
            WHEN pg.n_orders >= 5 THEN 5
            ELSE pg.n_orders
          END AS bucket_key,
          COUNT(*)::int AS customers
        FROM per_gk pg
        GROUP BY 1
      ),
      tot AS (
        SELECT COALESCE(SUM(bucketed.customers), 0)::numeric AS t
        FROM bucketed
      )
      SELECT json_agg(
        json_build_object(
          'bucket', b.bucket_key,
          'label',
          CASE b.bucket_key
            WHEN 1 THEN '1 nákup'
            WHEN 2 THEN '2 nákupy'
            WHEN 3 THEN '3 nákupy'
            WHEN 4 THEN '4 nákupy'
            ELSE '5+ nákupov'
          END,
          'customers', b.customers,
          'pct',
          CASE
            WHEN tot.t > 0 THEN ROUND(100.0 * b.customers / tot.t, 1)
            ELSE 0.0
          END
        )
        ORDER BY b.bucket_key
      )
      FROM bucketed b
      CROSS JOIN tot
    ),
    '[]'::json
  )
  INTO v_purchase_count_dist;

  SELECT COALESCE(
    (
      WITH win_ord AS (
        SELECT
          o.id,
          o.created_at,
          public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) AS gk
        FROM shopify_orders o
        WHERE o.created_at >= v_ts_from
          AND o.created_at < v_ts_to_excl
          AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
            'PAID',
            'PARTIALLY_PAID',
            'PARTIALLY_REFUNDED'
          )
          AND public.shopify_order_returning_group_key(o.raw_json, o.customer_id, o.customer_email) IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM shopify_order_line_items li_hp
            WHERE li_hp.order_id = o.id
              AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li_hp.sku, li_hp.title)
              AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li_hp.sku, li_hp.title, v_kpi_prod))
          )
      ),
      ordered AS (
        SELECT
          wo.gk,
          wo.created_at,
          LEAD(wo.created_at) OVER (PARTITION BY wo.gk ORDER BY wo.created_at ASC, wo.id ASC) AS next_created
        FROM win_ord wo
      ),
      pairs AS (
        SELECT
          GREATEST(
            0,
            (
              (ord.next_created AT TIME ZONE v_tz)::date
              - (ord.created_at AT TIME ZONE v_tz)::date
            )
          )::int AS days_gap
        FROM ordered ord
        WHERE ord.next_created IS NOT NULL
          AND ord.created_at >= v_ts_from
          AND ord.created_at < v_ts_to_excl
          AND ord.next_created >= v_ts_from
          AND ord.next_created < v_ts_to_excl
      ),
      bucketed AS (
        SELECT
          CASE
            WHEN p.days_gap <= 7 THEN 1
            WHEN p.days_gap <= 14 THEN 2
            WHEN p.days_gap <= 30 THEN 3
            WHEN p.days_gap <= 60 THEN 4
            WHEN p.days_gap <= 120 THEN 5
            ELSE 6
          END AS bucket_key,
          COUNT(*)::int AS interval_cnt
        FROM pairs p
        GROUP BY 1
      ),
      defs AS (
        SELECT * FROM (VALUES
          (1, '0–7 dní'),
          (2, '8–14 dní'),
          (3, '15–30 dní'),
          (4, '31–60 dní'),
          (5, '61–120 dní'),
          (6, '121+ dní')
        ) AS x(bucket_key, label)
      )
      SELECT json_build_object(
        'buckets',
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'bucket', d.bucket_key,
                'label', d.label,
                'count', COALESCE(b.interval_cnt, 0)
              )
              ORDER BY d.bucket_key
            )
            FROM defs d
            LEFT JOIN bucketed b ON b.bucket_key = d.bucket_key
          ),
          '[]'::json
        )
      )
    ),
    json_build_object('buckets', '[]'::json)
  )
  INTO v_interval_hist;

  RETURN json_build_object(
    'meta', json_build_object(
      'range', v_norm,
      'from', v_from::text,
      'to', v_to::text,
      'kpi_product', COALESCE(v_kpi_prod, 'all')
    ),
    'kpis', v_kpis,
    'dailyRevenue', v_daily,
    'topProducts', v_top,
    'topCustomers', v_top_customers,
    'recentOrders', v_recent,
    'monthlyNewVsReturning', v_monthly_new_ret,
    'purchaseCountDistribution', v_purchase_count_dist,
    'purchaseIntervalHistogram', v_interval_hist
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_shopify_dashboard_mvp(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shopify_dashboard_mvp(text, text) TO service_role;

COMMENT ON FUNCTION public.get_shopify_dashboard_mvp(text, text) IS 'Predaj MVP: topProducts canonical labels; purchaseIntervalHistogram; purchaseCountDistribution; monthlyNewVsReturning; optional p_kpi_product; ytd|30d|90d|365d';

ALTER FUNCTION public.get_shopify_dashboard_mvp(text, text) VOLATILE;




CREATE OR REPLACE FUNCTION public.get_shopify_sku_units_daily_ytd(
  p_range text DEFAULT 'ytd',
  p_kpi_product text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz CONSTANT text := 'Europe/Bratislava';
  v_today date;
  v_from date;
  v_to date;
  v_year int;
  v_ts_from timestamptz;
  v_ts_to_excl timestamptz;
  v_norm text;
  v_kpi_prod text;
  v_result json;
BEGIN
  v_norm := lower(trim(COALESCE(p_range, 'ytd')));
  IF v_norm NOT IN ('ytd', '30d', '90d', '365d') THEN
    RAISE EXCEPTION 'invalid p_range: % (allowed: ytd, 30d, 90d, 365d)', p_range;
  END IF;

  v_kpi_prod := lower(nullif(trim(coalesce(p_kpi_product, '')), ''));
  IF v_kpi_prod = '' OR v_kpi_prod = 'all' THEN
    v_kpi_prod := NULL;
  END IF;
  IF v_kpi_prod IS NOT NULL AND v_kpi_prod NOT IN ('moja_phase_bez', 'moja_phase_plus') THEN
    RAISE EXCEPTION 'invalid p_kpi_product: % (allowed: all, moja_phase_bez, moja_phase_plus)', p_kpi_product;
  END IF;

  v_today := (CURRENT_TIMESTAMP AT TIME ZONE v_tz)::date;
  v_to := v_today;

  IF v_norm = 'ytd' THEN
    v_year := EXTRACT(YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE v_tz))::int;
    v_from := make_date(v_year, 1, 1);
  ELSIF v_norm = '30d' THEN
    v_from := v_today - 29;
  ELSIF v_norm = '90d' THEN
    v_from := v_today - 89;
  ELSE
    v_from := v_today - 364;
  END IF;

  v_ts_from := (v_from::timestamp AT TIME ZONE v_tz);
  v_ts_to_excl := ((v_to + 1)::timestamp AT TIME ZONE v_tz);

  WITH paid_orders AS (
    SELECT o.id, o.created_at
    FROM shopify_orders o
    WHERE o.created_at >= v_ts_from
      AND o.created_at < v_ts_to_excl
      AND UPPER(REPLACE(TRIM(COALESCE(o.financial_status, '')), ' ', '_')) IN (
        'PAID',
        'PARTIALLY_PAID',
        'PARTIALLY_REFUNDED'
      )
      AND (
        (v_kpi_prod IS NULL AND public.shopify_order_has_product_line(o.id))
        OR (
          v_kpi_prod IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM shopify_order_line_items li_hp
            WHERE li_hp.order_id = o.id
              AND NOT public.shopify_line_item_excluded_from_predaj_dashboard(li_hp.sku, li_hp.title)
              AND public.shopify_line_matches_kpi_product_filter(li_hp.sku, li_hp.title, v_kpi_prod)
          )
        )
      )
  ),
  line_agg AS (
    SELECT
      (po.created_at AT TIME ZONE v_tz)::date AS d,
      public.shopify_product_display_label(li.sku, li.title) AS sku_label,
      SUM(li.quantity)::bigint AS units
    FROM paid_orders po
    INNER JOIN shopify_order_line_items li ON li.order_id = po.id
    WHERE NOT public.shopify_line_item_excluded_from_predaj_dashboard(li.sku, li.title)
      AND (v_kpi_prod IS NULL OR public.shopify_line_matches_kpi_product_filter(li.sku, li.title, v_kpi_prod))
    GROUP BY 1, 2
  ),
  sku_rank AS (
    SELECT sku_label, SUM(units) AS tot
    FROM line_agg
    GROUP BY 1
    ORDER BY tot DESC
    LIMIT 10
  ),
  filtered AS (
    SELECT la.d, la.sku_label, la.units
    FROM line_agg la
    INNER JOIN sku_rank sr ON sr.sku_label = la.sku_label
  )
  SELECT json_build_object(
    'year', EXTRACT(YEAR FROM v_from)::int,
    'range', v_norm,
    'from', v_from::text,
    'to', v_to::text,
    'kpi_product', COALESCE(v_kpi_prod, 'all'),
    'skuOrder',
    COALESCE(
      (SELECT json_agg(sr.sku_label ORDER BY sr.tot DESC) FROM sku_rank sr),
      '[]'::json
    ),
    'points',
    COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'date', f.d::text,
            'sku', f.sku_label,
            'units', f.units
          )
          ORDER BY f.d, f.sku_label
        )
        FROM filtered f
      ),
      '[]'::json
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_shopify_sku_units_daily_ytd(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shopify_sku_units_daily_ytd(text, text) TO service_role;

COMMENT ON FUNCTION public.get_shopify_sku_units_daily_ytd(text, text) IS 'Daily units per top-10 canonical labels (shopify_product_display_label); paid_orders: has_product_line or KPI-matching line; p_range ytd|30d|90d|365d';

ALTER FUNCTION public.get_shopify_sku_units_daily_ytd(text, text) VOLATILE;
