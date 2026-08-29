-- honzabartos.cz = Meta agency fee (Honza Bartoš). Bank counterparty already in Tatra;
-- journal invoices may land later under the same name.

INSERT INTO public.marketing_expense_map (priority, match_supplier, match_text, bucket, fee_category, notes)
SELECT 21, 'honzabartos', NULL, 'fees', 'agency', 'Meta agentúra — Honza Bartoš (honzabartos.cz)'
WHERE NOT EXISTS (
  SELECT 1 FROM public.marketing_expense_map m
  WHERE m.match_supplier = 'honzabartos' AND m.bucket = 'fees'
);

CREATE OR REPLACE FUNCTION public.classify_journal_marketing_expense(
  p_text text,
  p_partner text,
  p_company text,
  p_debit_account text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_hay text;
  v_acct text;
  r record;
BEGIN
  v_hay := lower(
    concat_ws(
      ' ',
      coalesce(p_text, ''),
      coalesce(p_partner, ''),
      coalesce(p_company, '')
    )
  );
  v_acct := trim(coalesce(p_debit_account, ''));

  IF v_acct = '' THEN
    RETURN NULL;
  END IF;

  IF v_hay ~ '(^|\s)úhrada\s+fp|(^|\s)tb00' THEN
    RETURN NULL;
  END IF;

  IF v_acct !~ '^(518|5015)' THEN
    RETURN NULL;
  END IF;

  FOR r IN
    SELECT m.bucket
    FROM public.marketing_expense_map m
    WHERE (m.match_account IS NULL OR v_acct LIKE m.match_account || '%')
      AND (m.match_text IS NULL OR v_hay LIKE '%' || lower(m.match_text) || '%')
      AND (
        m.match_supplier IS NULL
        OR v_hay LIKE '%' || lower(m.match_supplier) || '%'
      )
    ORDER BY m.priority ASC, m.id ASC
    LIMIT 1
  LOOP
    RETURN r.bucket;
  END LOOP;

  IF v_hay ~ 'shopify|web\s*shop' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'stripe' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'visuel|údržba webu|udrzba webu' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'le\s*soft|čechovsk|cechovsk|projektov' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'ids\s*health' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'danetax|mof invest|swiss point|green\s*print' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'lidet|feminea' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'leri' AND v_hay ~ 'konzult' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'ytd s|finančný reporting|financny reporting' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'superfaktura' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'advokát|advokat|matej vida' THEN RETURN 'exclude'; END IF;
  IF v_hay ~ 'gs1' THEN RETURN 'exclude'; END IF;
  IF v_acct LIKE '518220%' THEN RETURN 'exclude'; END IF;

  IF v_hay ~ 'meta\s*platforms|meta\s*reklamy' THEN RETURN 'ads_skip'; END IF;

  IF v_hay ~ 'filip|žitňansk|zitnansk|správa ppc|sprava ppc|ppc' THEN RETURN 'fees'; END IF;
  IF v_hay ~ 'vk\s*marketing|nastavenie google ads|honzabartos|bartoš|bartos' THEN RETURN 'fees'; END IF;
  IF v_hay ~ 'bcreativum|produkcia podcastu|reels' THEN RETURN 'fees'; END IF;
  IF v_hay ~ 'zelina|promo videí|promo videi|nadacia vw|nadácia vw' THEN RETURN 'fees'; END IF;
  IF v_hay ~ 'knižnica|kniznica|maskér|masker' THEN RETURN 'fees'; END IF;
  IF v_hay ~ 'steli' THEN RETURN 'fees'; END IF;
  IF v_hay ~ 'hup-zagreb|studio echt|upterdam|serica|e-commerce day|e-commerce konferencia' THEN RETURN 'fees'; END IF;
  IF v_hay ~ 'mailerlite|mailersend|mailer' THEN RETURN 'fees'; END IF;
  IF v_hay ~ 'manychat|chatovac' THEN RETURN 'fees'; END IF;
  IF v_hay ~ 'canva' THEN RETURN 'fees'; END IF;
  IF v_hay ~ 'agnw|dizajn\s*manu' THEN RETURN 'fees'; END IF;
  IF v_hay ~ 'kurečkov|kureckov|ideamaking|copywriting' THEN RETURN 'fees'; END IF;
  IF v_hay ~ 'asaprint|letáky|letaky|marketingový materiál|marketingovy material' THEN RETURN 'fees'; END IF;
  IF v_hay ~ 'birne\s*studio|inputflow' THEN RETURN 'fees'; END IF;

  RETURN NULL;
END;
$$;

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

  IF v_hay ~ 'správa\s*ppc|sprava\s*ppc|žitňansk|zitnansk|honzabartos|bartoš|bartos|vk market' THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.classify_journal_marketing_expense(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classify_journal_marketing_expense(text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.is_journal_agency_management_fee(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_journal_agency_management_fee(text, text, text, text) TO service_role;
