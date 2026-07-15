export type CashflowEnrichedTx = {
  booking_date: string;
  amount: number;
  creditor_name?: string | null;
  debtor_name?: string | null;
  creditor_iban?: string | null;
  debtor_iban?: string | null;
  remittance_info?: string | null;
};

export type CashflowPieSlice = {
  label: string;
  total: number;
  count: number;
};

const TOP_N = 8;

/** Známe aliasy — kľúč = normalizované meno, hodnota = zobrazený názov. */
const PERSON_DISPLAY_ALIASES: Record<string, string> = {
  "peter|skutil": "Peter Škutil",
};

const COMPANY_MARKERS =
  /\b(s\.?\s*r\.?\s*o\.?|a\.?\s*s\.?|spol\.?|k\.?\s*s\.?|v\.?\s*o\.?\s*s\.?|gmbh|inc\.?|ltd\.?)\b/i;

function stripDiacritics(s: string): string {
  const map: Record<string, string> = {
    á: "a",
    ä: "a",
    č: "c",
    ď: "d",
    é: "e",
    í: "i",
    ĺ: "l",
    ľ: "l",
    ň: "n",
    ó: "o",
    ô: "o",
    ö: "o",
    ŕ: "r",
    š: "s",
    ť: "t",
    ú: "u",
    ü: "u",
    ý: "y",
    ž: "z",
  };
  return s
    .split("")
    .map((ch) => map[ch] ?? map[ch.toLowerCase()] ?? ch)
    .join("");
}

function normalizePersonNameKey(label: string): string | null {
  const trimmed = label.trim();
  if (!trimmed || trimmed === "Neuvedené") return null;
  if (/^SK\d/i.test(trimmed)) return null;
  if (COMPANY_MARKERS.test(trimmed)) return null;
  if (trimmed.length > 48) return null;

  let s = trimmed.replace(
    /^(Mgr\.|Bc\.|Ing\.|MUDr\.|JUDr\.|PhDr\.|RNDr\.)\s+/gi,
    ""
  );
  s = stripDiacritics(s.toLowerCase());
  const tokens = s
    .split(/[\s,.-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
  if (tokens.length < 2 || tokens.length > 4) return null;
  return tokens.sort().join("|");
}

function groupKeyForLabel(label: string): string {
  return normalizePersonNameKey(label) ?? label;
}

function displayLabelForGroup(
  groupKey: string,
  labelCounts: Map<string, number>
): string {
  const alias = PERSON_DISPLAY_ALIASES[groupKey];
  if (alias) return alias;

  let best = groupKey;
  let bestCount = -1;
  for (const [label, count] of Array.from(labelCounts.entries())) {
    if (
      count > bestCount ||
      (count === bestCount && label.localeCompare(best, "sk") < 0)
    ) {
      best = label;
      bestCount = count;
    }
  }
  return best;
}

const MONTH_SK = [
  "Január",
  "Február",
  "Marec",
  "Apríl",
  "Máj",
  "Jún",
  "Júl",
  "August",
  "September",
  "Október",
  "November",
  "December",
] as const;

export const CASHFLOW_PIE_COLORS = [
  "hsl(48 72% 52%)",
  "hsl(142 38% 42%)",
  "hsl(210 42% 48%)",
  "hsl(12 55% 52%)",
  "hsl(280 35% 52%)",
  "hsl(185 42% 40%)",
  "hsl(32 60% 50%)",
  "hsl(340 40% 52%)",
  "hsl(220 18% 58%)",
];

/** Protistrana z bankových polí (bez counterparty map). */
export function txnCounterpartyLabel(tx: CashflowEnrichedTx): string {
  if (tx.amount >= 0) {
    const name = tx.debtor_name?.trim();
    if (name) return name;
    const iban = tx.debtor_iban?.trim();
    if (iban) return iban;
  } else {
    const name = tx.creditor_name?.trim();
    if (name) return name;
    const iban = tx.creditor_iban?.trim();
    if (iban) return iban;
  }
  const rem = tx.remittance_info?.trim();
  if (rem) {
    return rem.length > 48 ? `${rem.slice(0, 46)}…` : rem;
  }
  return "Neuvedené";
}

/** Zobrazená protistrana — zlučené varianty mien (Peter Škutil / Skutil). */
export function displayCounterparty(tx: CashflowEnrichedTx): string {
  const raw = txnCounterpartyLabel(tx);
  const groupKey = groupKeyForLabel(raw);
  if (groupKey === raw) return raw;
  return displayLabelForGroup(groupKey, new Map([[raw, 1]]));
}

export function aggregatePieSlices(
  txns: CashflowEnrichedTx[],
  direction: "credit" | "debit",
  monthKey: string
): CashflowPieSlice[] {
  const byGroup = new Map<
    string,
    { total: number; count: number; labelCounts: Map<string, number> }
  >();

  for (const tx of txns) {
    const isCredit = tx.amount > 0;
    if (direction === "credit" && !isCredit) continue;
    if (direction === "debit" && isCredit) continue;
    if (monthKey) {
      const mk = tx.booking_date.slice(0, 7);
      if (mk !== monthKey) continue;
    }
    const rawLabel = txnCounterpartyLabel(tx);
    const groupKey = groupKeyForLabel(rawLabel);
    const abs = Math.abs(tx.amount);
    if (!Number.isFinite(abs) || abs <= 0) continue;
    const bucket = byGroup.get(groupKey) ?? {
      total: 0,
      count: 0,
      labelCounts: new Map<string, number>(),
    };
    bucket.total += abs;
    bucket.count += 1;
    bucket.labelCounts.set(
      rawLabel,
      (bucket.labelCounts.get(rawLabel) ?? 0) + 1
    );
    byGroup.set(groupKey, bucket);
  }

  const sorted = Array.from(byGroup.entries())
    .map(([groupKey, v]) => ({
      label: displayLabelForGroup(groupKey, v.labelCounts),
      total: v.total,
      count: v.count,
    }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);

  if (sorted.length <= TOP_N + 1) return sorted;

  const top = sorted.slice(0, TOP_N);
  const rest = sorted.slice(TOP_N);
  const otherTotal = rest.reduce((s, r) => s + r.total, 0);
  const otherCount = rest.reduce((s, r) => s + r.count, 0);
  if (otherTotal > 0) {
    top.push({ label: "Ostatné", total: otherTotal, count: otherCount });
  }
  return top;
}

export function monthKeyFromRow(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function chartPeriodLabel(monthKey: string): string {
  if (!monthKey) return "všetky mesiace";
  const [y, m] = monthKey.split("-");
  const mi = Number(m);
  const yi = Number(y);
  if (!Number.isFinite(mi) || !Number.isFinite(yi) || mi < 1 || mi > 12) {
    return monthKey;
  }
  return `${MONTH_SK[mi - 1]} ${yi}`;
}
