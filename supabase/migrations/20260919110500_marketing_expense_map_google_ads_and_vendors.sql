-- Marketing MER mapovanie pre nové položky.
-- Google Ireland Limited je Ads (denník skip), ostatné idú do Fees.

INSERT INTO public.marketing_expense_map (
  priority,
  match_supplier,
  match_text,
  match_account,
  bucket,
  fee_category,
  notes
)
SELECT
  v.priority,
  v.match_supplier,
  v.match_text,
  v.match_account,
  v.bucket,
  v.fee_category,
  v.notes
FROM (
  VALUES
    (
      18,
      'google ireland limited',
      'google reklamy',
      NULL,
      'ads_skip',
      'google_ads',
      'Google Ads spend z denníka; má ísť do Ads, nie do Fees.'
    ),
    (
      19,
      'cam on s. r. o.',
      'vytvorenie podcastu',
      NULL,
      'fees',
      'creative',
      'Marketingový výstup / produkcia podcastu.'
    ),
    (
      19,
      'mgr. art. jakub čajko',
      'fototgrafické služby',
      NULL,
      'fees',
      'creative',
      'Fotografické služby pre marketing.'
    ),
    (
      19,
      'websupport s. r. o.',
      'časové rozlíšenie daňového dokladu',
      '518120',
      'fees',
      'web',
      'Web / hosting / rozlíšenie nákladov; má patriť do marketingového spendu.'
    )
) AS v(priority, match_supplier, match_text, match_account, bucket, fee_category, notes)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.marketing_expense_map m
  WHERE coalesce(lower(m.match_supplier), '') = coalesce(v.match_supplier, '')
    AND coalesce(lower(m.match_text), '') = coalesce(v.match_text, '')
    AND coalesce(lower(m.match_account), '') = coalesce(v.match_account, '')
    AND m.bucket = v.bucket
);
