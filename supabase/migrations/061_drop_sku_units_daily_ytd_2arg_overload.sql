-- PostgREST nevie vybrať medzi 2- a 3-arg overloadom get_shopify_sku_units_daily_ytd
-- pri volaní s { p_range } → PGRST203 / SQL error v dashboarde.

DROP FUNCTION IF EXISTS public.get_shopify_sku_units_daily_ytd(text, text);

NOTIFY pgrst, 'reload schema';
