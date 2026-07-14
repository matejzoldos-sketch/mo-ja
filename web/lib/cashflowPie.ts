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

export function aggregatePieSlices(
  txns: CashflowEnrichedTx[],
  direction: "credit" | "debit",
  monthKey: string
): CashflowPieSlice[] {
  const byLabel = new Map<string, { total: number; count: number }>();

  for (const tx of txns) {
    const isCredit = tx.amount > 0;
    if (direction === "credit" && !isCredit) continue;
    if (direction === "debit" && isCredit) continue;
    if (monthKey) {
      const mk = tx.booking_date.slice(0, 7);
      if (mk !== monthKey) continue;
    }
    const label = txnCounterpartyLabel(tx);
    const abs = Math.abs(tx.amount);
    if (!Number.isFinite(abs) || abs <= 0) continue;
    const bucket = byLabel.get(label) ?? { total: 0, count: 0 };
    bucket.total += abs;
    bucket.count += 1;
    byLabel.set(label, bucket);
  }

  const sorted = Array.from(byLabel.entries())
    .map(([label, v]) => ({ label, total: v.total, count: v.count }))
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
