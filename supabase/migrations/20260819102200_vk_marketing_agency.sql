-- VK Marketing is the Google Ads agency → include in mROAS agency fees
CREATE OR REPLACE FUNCTION public.is_journal_agency_management_fee(
  p_text text,
  p_partner text,
  p_company text,
  p_debit_account text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_hay text;
  r record;
BEGIN
  IF public.classify_journal_marketing_expense(
    p_text, p_partner, p_company, p_debit_account
  ) IS DISTINCT FROM 'fees' THEN
    RETURN false;
  END IF;

  v_hay := lower(
    concat_ws(
      ' ',
      coalesce(p_text, ''),
      coalesce(p_partner, ''),
      coalesce(p_company, '')
    )
  );

  FOR r IN
    SELECT 1
    FROM public.marketing_expense_map m
    WHERE m.fee_category = 'agency'
      AND m.bucket = 'fees'
      AND (m.match_text IS NULL OR v_hay LIKE '%' || lower(m.match_text) || '%')
      AND (
        m.match_supplier IS NULL
        OR v_hay LIKE '%' || lower(m.match_supplier) || '%'
      )
    LIMIT 1
  LOOP
    RETURN true;
  END LOOP;

  IF v_hay ~ 'správa\s*ppc|sprava\s*ppc|žitňansk|zitnansk|bartoš|bartos|vk market' THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.is_journal_agency_management_fee(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_journal_agency_management_fee(text, text, text, text) TO service_role;
