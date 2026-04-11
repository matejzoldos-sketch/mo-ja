-- Čítajú CURRENT_TIMESTAMP + mutovateľné tabuľky → musia byť VOLATILE, nie STABLE.
-- STABLE planner môže pri niektorých kontextoch nesprávne predpokladať „deterministiku“.

ALTER FUNCTION public.get_shopify_dashboard_mvp(text) VOLATILE;
ALTER FUNCTION public.get_shopify_sku_units_daily_ytd() VOLATILE;
ALTER FUNCTION public.get_dashboard_last_sync_at() VOLATILE;
