/**
 * Marketingové mapovanie bankových debetov.
 * Overiť neskôr: ASAPRINT / Visuel / Canva / hotely / konferencie.
 */

export type MarketingMatchTx = {
  amount: number;
  creditor_name?: string | null;
  debtor_name?: string | null;
  creditor_iban?: string | null;
  trading_party?: string | null;
  additional_info?: string | null;
  remittance_info?: string | null;
};

export type MarketingBucket =
  | "BCreativum"
  | "Bc. Filip Žitňanský"
  | "Meta agentúra"
  | "Google agentúra"
  | "Meta"
  | "Google Ads"
  | "Mailer"
  | "InputFlow"
  | "ManyChat"
  | "Web"
  | "Reklamný materiál"
  | "Cestovné"
  | "Ostatné (marketing)";

type MatchRule = {
  bucket: MarketingBucket;
  /** Match against joined haystack (names, merchant, remittance, iban). */
  pattern: RegExp;
};

const MARKETING_RULES: MatchRule[] = [
  // Isté — paid media / tools / dodávatelia
  { bucket: "Meta", pattern: /\bfacebk\b|\bfacebook\b|fb\.me\/ads/i },
  { bucket: "Google Ads", pattern: /\bgoogle\s*ads/i },
  {
    bucket: "Mailer",
    pattern: /mailerlite|mailersend|\bmailer\b/i,
  },
  { bucket: "InputFlow", pattern: /inputflow/i },
  { bucket: "ManyChat", pattern: /manychat/i },
  {
    bucket: "Web",
    pattern: /webflow|websupport/i,
  },
  {
    bucket: "BCreativum",
    pattern: /bcreativum|sk2011000000002947228744/i,
  },
  {
    bucket: "Bc. Filip Žitňanský",
    pattern: /žitňansk|zitnansk|sk8511000000002946195397/i,
  },
  {
    bucket: "Meta agentúra",
    pattern: /\bagnw\b|sk5009000000005059540928/i,
  },
  {
    bucket: "Google agentúra",
    pattern: /ids\s*health|sk3809000000000449179450/i,
  },

  // Overiť neskôr
  {
    bucket: "Reklamný materiál",
    pattern:
      /asaprint|green\s*print|visuel|faxcopy|sk8011000000002948170310|sk2211000000002928873107|sk7883300000002001405121/i,
  },
  {
    bucket: "Cestovné",
    pattern:
      /\bhotel\b|ecommerceday|konferencia\s*echt|upterdam|zonar|albrecht/i,
  },
  {
    bucket: "Ostatné (marketing)",
    pattern: /\bcanva\b|birne\s*studio/i,
  },
];

function marketingHaystack(tx: MarketingMatchTx, rawLabel: string): string {
  return [
    rawLabel,
    tx.creditor_name,
    tx.debtor_name,
    tx.trading_party,
    tx.additional_info,
    tx.remittance_info,
    tx.creditor_iban,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Ak debet sedí na marketingové pravidlo, vráti bucket label. */
export function matchMarketingBucket(
  tx: MarketingMatchTx,
  rawLabel: string
): MarketingBucket | null {
  if (tx.amount >= 0) return null;
  const hay = marketingHaystack(tx, rawLabel);
  // Výbery / mzdy cez Škutila nepatria do marketingu (ani keď je v poznámke „letaky“).
  if (/skutil|škutil/i.test(hay)) return null;
  for (const rule of MARKETING_RULES) {
    if (rule.pattern.test(hay)) return rule.bucket;
  }
  return null;
}

export function isMarketingBucket(label: string): boolean {
  return MARKETING_RULES.some((r) => r.bucket === label);
}
