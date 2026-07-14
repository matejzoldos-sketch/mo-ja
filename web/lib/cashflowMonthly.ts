export type CashflowTx = {
  booking_date: string;
  amount: number;
};

export type CashflowMonthRow = {
  year: number;
  month: number;
  label: string;
  isPartial: boolean;
  opening: number;
  credit: number;
  debit: number;
  net: number;
  closing: number;
};

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

function monthKey(d: string): string | null {
  const ymd = (d || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  return ymd.slice(0, 7);
}

function bratislavaTodayParts(now = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bratislava",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? Number.NaN);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function monthLabel(year: number, month: number, isPartial: boolean): string {
  const name = MONTH_SK[month - 1] ?? String(month);
  return isPartial ? `${name} ${year}*` : `${name} ${year}`;
}

export function buildCashflowMonths(
  currentBalance: number,
  transactions: CashflowTx[],
  periodStart = "2026-01-01",
  now = new Date()
): { rows: CashflowMonthRow[]; openingAtPeriodStart: number; ytdNet: number } {
  const startYmd = periodStart.slice(0, 10);
  const startYear = Number(startYmd.slice(0, 4));
  const startMonth = Number(startYmd.slice(5, 7));

  const byMonth = new Map<string, { credit: number; debit: number; net: number }>();
  let ytdNet = 0;

  for (const tx of transactions) {
    const key = monthKey(tx.booking_date);
    if (!key || key < startYmd.slice(0, 7)) continue;
    const amt = Number(tx.amount);
    if (!Number.isFinite(amt)) continue;
    ytdNet += amt;
    const bucket = byMonth.get(key) ?? { credit: 0, debit: 0, net: 0 };
    if (amt > 0) bucket.credit += amt;
    else bucket.debit += -amt;
    bucket.net += amt;
    byMonth.set(key, bucket);
  }

  const openingAtPeriodStart = currentBalance - ytdNet;

  const today = bratislavaTodayParts(now);
  const rows: CashflowMonthRow[] = [];
  let opening = openingAtPeriodStart;

  let y = startYear;
  let m = startMonth;

  while (y < today.year || (y === today.year && m <= today.month)) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    const bucket = byMonth.get(key) ?? { credit: 0, debit: 0, net: 0 };
    const isPartial = y === today.year && m === today.month;
    const closing = opening + bucket.net;
    rows.push({
      year: y,
      month: m,
      label: monthLabel(y, m, isPartial),
      isPartial,
      opening,
      credit: bucket.credit,
      debit: bucket.debit,
      net: bucket.net,
      closing,
    });
    opening = closing;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }

  return { rows, openingAtPeriodStart, ytdNet };
}
