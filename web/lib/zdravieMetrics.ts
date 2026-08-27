import type { CashflowMonthRow } from "./cashflowMonthly";
import {
  displayCounterparty,
  type CashflowEnrichedTx,
} from "./cashflowPie";
import {
  buildCashflowRunway,
  CASHFLOW_RUNWAY_BUFFER_EUR,
  RUNWAY_SCENARIO_META,
  runwayUntilLabel,
  type RunwayScenarioId,
} from "./cashflowRunway";
import type { PnlHybridMonth, PnlHybridPayload } from "./pnlHybrid";

const OWNER_NAME_HINTS = [
  "peter škutil",
  "peter skutil",
  "škutil",
  "skutil",
  "zöldos",
  "zoldos",
  "matej",
];

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

function isOwnerWithdrawal(tx: CashflowEnrichedTx): boolean {
  if (!(tx.amount < 0)) return false;
  const label = displayCounterparty(tx).toLowerCase();
  const flat = stripDiacritics(label);
  return OWNER_NAME_HINTS.some(
    (h) => flat.includes(stripDiacritics(h)) || label.includes(h)
  );
}

function isOrinPurchase(tx: CashflowEnrichedTx): boolean {
  if (!(tx.amount < 0)) return false;
  const hay = [
    tx.creditor_name,
    tx.debtor_name,
    tx.remittance_info,
    tx.trading_party,
    tx.additional_info,
    displayCounterparty(tx),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /\borin\b/i.test(hay);
}

export type ZdravieCashPressure = {
  label: string;
  ytd: number;
  count: number;
};

export type ZdravieJoinedMonth = {
  month_key: string;
  label: string;
  isPartial: boolean;
  revenue: number | null;
  cogs: number | null;
  opex: number | null;
  contribution_margin: number | null;
  margin_pct: number | null;
  marketing: number | null;
  staff: number | null;
  cash_net: number | null;
  cash_close: number | null;
};

export type ZdravieRunwaySummary = {
  lastActualLabel: string;
  lastActualClose: number;
  yearEnd: Record<RunwayScenarioId, number>;
  minFromNow: Record<RunwayScenarioId, number>;
  firstBelowZero: Record<RunwayScenarioId, string | null>;
  untilLabel: Record<RunwayScenarioId, string>;
  untilLabelNoOwner: Record<RunwayScenarioId, string>;
  yearEndNoOwner: Record<RunwayScenarioId, number>;
  bufferEur: number;
  scenarioMeta: typeof RUNWAY_SCENARIO_META;
};

export type ZdravieKpis = {
  currentBalance: number;
  ytdNetCash: number;
  openingAtPeriodStart: number;
  revenueYtd: number;
  cogsYtd: number;
  opexYtd: number;
  cmYtd: number;
  marginYtd: number | null;
  margin3m: number | null;
  revenue3m: number;
  cm3m: number;
  marketingYtd: number;
  staffYtd: number;
  marketingPct: number | null;
  staffPct: number | null;
  ownerWithdrawalsYtd: number;
  orinPurchasesYtd: number;
  pnlLastMonthKey: string | null;
  cashLastSync: string | null;
};

function monthKeyFromCash(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function pnlByMonthKey(
  months: PnlHybridMonth[]
): Map<string, PnlHybridMonth> {
  return new Map(months.map((m) => [m.month_key, m]));
}

export function joinZdravieMonths(
  pnl: PnlHybridPayload,
  cashMonths: CashflowMonthRow[]
): ZdravieJoinedMonth[] {
  const byPnl = pnlByMonthKey(pnl.monthly);
  const keys = new Set<string>();
  for (const m of pnl.monthly) keys.add(m.month_key);
  for (const m of cashMonths) keys.add(monthKeyFromCash(m.year, m.month));

  const sorted = Array.from(keys).sort();
  return sorted.map((month_key) => {
    const p = byPnl.get(month_key);
    const [ys, ms] = month_key.split("-").map(Number);
    const c = cashMonths.find((row) => row.year === ys && row.month === ms);
    const revenue = p?.total_revenue ?? null;
    const cm = p?.contribution_margin ?? null;
    return {
      month_key,
      label: c?.label ?? month_key,
      isPartial: Boolean(c?.isPartial),
      revenue,
      cogs: p?.cogs ?? null,
      opex: p?.total_opex ?? null,
      contribution_margin: cm,
      margin_pct:
        revenue != null && cm != null && revenue > 0 ? cm / revenue : null,
      marketing: p?.marketing_spend ?? null,
      staff: p?.staff_spend ?? null,
      cash_net: c?.net ?? null,
      cash_close: c?.closing ?? null,
    };
  });
}

export function lastNMargin(
  months: ZdravieJoinedMonth[],
  n: number
): { revenue: number; cm: number; margin: number | null } {
  const withPnl = months.filter(
    (m) => m.revenue != null && m.contribution_margin != null
  );
  const slice = withPnl.slice(-n);
  const revenue = slice.reduce((s, m) => s + (m.revenue ?? 0), 0);
  const cm = slice.reduce((s, m) => s + (m.contribution_margin ?? 0), 0);
  return {
    revenue,
    cm,
    margin: revenue > 0 ? cm / revenue : null,
  };
}

export function sumCashPressures(txns: CashflowEnrichedTx[]): {
  owner: ZdravieCashPressure;
  orin: ZdravieCashPressure;
} {
  let ownerYtd = 0;
  let ownerCount = 0;
  let orinYtd = 0;
  let orinCount = 0;
  for (const tx of txns) {
    if (isOwnerWithdrawal(tx)) {
      ownerYtd += Math.abs(tx.amount);
      ownerCount += 1;
    }
    if (isOrinPurchase(tx)) {
      orinYtd += Math.abs(tx.amount);
      orinCount += 1;
    }
  }
  return {
    owner: {
      label: "Výbery majiteľa (odhad)",
      ytd: Math.round(ownerYtd * 100) / 100,
      count: ownerCount,
    },
    orin: {
      label: "Nákupy ORIN",
      ytd: Math.round(orinYtd * 100) / 100,
      count: orinCount,
    },
  };
}

export function buildRunwaySummary(
  cashMonths: CashflowMonthRow[]
): ZdravieRunwaySummary | null {
  const withOwner = buildCashflowRunway(cashMonths, { freezeOwner: false });
  const noOwner = buildCashflowRunway(cashMonths, { freezeOwner: true });
  if (!withOwner || !noOwner) return null;

  const untilLabel = {} as Record<RunwayScenarioId, string>;
  const untilLabelNoOwner = {} as Record<RunwayScenarioId, string>;
  for (const id of Object.keys(RUNWAY_SCENARIO_META) as RunwayScenarioId[]) {
    untilLabel[id] = runwayUntilLabel(withOwner, id);
    untilLabelNoOwner[id] = runwayUntilLabel(noOwner, id);
  }

  return {
    lastActualLabel: withOwner.lastActualLabel,
    lastActualClose: withOwner.lastActualClose,
    yearEnd: withOwner.yearEnd,
    minFromNow: withOwner.minFromNow,
    firstBelowZero: withOwner.firstBelowZero,
    untilLabel,
    untilLabelNoOwner,
    yearEndNoOwner: noOwner.yearEnd,
    bufferEur: CASHFLOW_RUNWAY_BUFFER_EUR,
    scenarioMeta: RUNWAY_SCENARIO_META,
  };
}

export function buildZdravieKpis(input: {
  pnl: PnlHybridPayload;
  joined: ZdravieJoinedMonth[];
  currentBalance: number;
  ytdNetCash: number;
  openingAtPeriodStart: number;
  cashLastSync: string | null;
  pressures: ReturnType<typeof sumCashPressures>;
}): ZdravieKpis {
  const t = input.pnl.totals;
  const m3 = lastNMargin(input.joined, 3);
  const rev = t.total_revenue;
  return {
    currentBalance: input.currentBalance,
    ytdNetCash: input.ytdNetCash,
    openingAtPeriodStart: input.openingAtPeriodStart,
    revenueYtd: t.total_revenue,
    cogsYtd: t.cogs,
    opexYtd: t.total_opex,
    cmYtd: t.contribution_margin,
    marginYtd: rev > 0 ? t.contribution_margin / rev : null,
    margin3m: m3.margin,
    revenue3m: m3.revenue,
    cm3m: m3.cm,
    marketingYtd: t.marketing_spend,
    staffYtd: t.staff_spend,
    marketingPct: rev > 0 ? t.marketing_spend / rev : null,
    staffPct: rev > 0 ? t.staff_spend / rev : null,
    ownerWithdrawalsYtd: input.pressures.owner.ytd,
    orinPurchasesYtd: input.pressures.orin.ytd,
    pnlLastMonthKey: input.pnl.meta.last_month_key ?? null,
    cashLastSync: input.cashLastSync,
  };
}
