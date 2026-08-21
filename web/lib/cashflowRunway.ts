import type { CashflowMonthRow } from "./cashflowMonthly";

export type RunwayScenarioId = "cons" | "base" | "opt";

export const CASHFLOW_RUNWAY_BUFFER_EUR = 3000;

export const RUNWAY_SCENARIO_ORDER: RunwayScenarioId[] = [
  "cons",
  "base",
  "opt",
];

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

/**
 * Mesačný net (€) na hlavnom účte pre zvyšok 2026 (sep–dec).
 * Odhad z H1 Tatra + Shopify; nie je to bankový prísľub.
 */
const NET_BY_MONTH_2026: Record<RunwayScenarioId, Partial<Record<number, number>>> = {
  cons: { 9: -4000, 10: -4000, 11: -3500, 12: -3000 },
  base: { 9: -1500, 10: -1000, 11: 500, 12: 1500 },
  opt: { 9: 1500, 10: 2000, 11: 3500, 12: 4000 },
};

const OWNER_MO_2026: Record<RunwayScenarioId, number> = {
  cons: 4000,
  base: 2500,
  opt: 1500,
};

export const RUNWAY_SCENARIO_META: Record<
  RunwayScenarioId,
  { label: string; short: string }
> = {
  cons: { label: "Konzervatívny", short: "Konzervatívny" },
  base: { label: "Základný", short: "Základný" },
  opt: { label: "Optimistický", short: "Optimistický" },
};

export type RunwayForecastMonth = {
  year: number;
  month: number;
  label: string;
  net: Record<RunwayScenarioId, number>;
  close: Record<RunwayScenarioId, number>;
};

export type CashflowRunway = {
  labels: string[];
  actual: Array<number | null>;
  scenarios: Record<RunwayScenarioId, Array<number | null>>;
  forecastMonths: RunwayForecastMonth[];
  lastActualLabel: string;
  lastActualClose: number;
  firstBelowZero: Record<RunwayScenarioId, string | null>;
  yearEnd: Record<RunwayScenarioId, number>;
  minFromNow: Record<RunwayScenarioId, number>;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function forecastLabel(year: number, month: number): string {
  return `${MONTH_SK[month - 1] ?? month} ${year}`;
}

function emptyScenarioMap<T>(value: T): Record<RunwayScenarioId, T> {
  return { cons: value, base: value, opt: value };
}

function scenarioNet(
  year: number,
  month: number,
  id: RunwayScenarioId,
  freezeOwner: boolean
): number | null {
  if (year !== 2026) return null;
  const base = NET_BY_MONTH_2026[id][month];
  if (base == null) return null;
  return freezeOwner ? base + OWNER_MO_2026[id] : base;
}

export function buildCashflowRunway(
  months: Pick<
    CashflowMonthRow,
    "year" | "month" | "label" | "closing"
  >[],
  options?: { freezeOwner?: boolean }
): CashflowRunway | null {
  if (months.length === 0) return null;

  const freezeOwner = Boolean(options?.freezeOwner);
  const last = months[months.length - 1];
  const lastClose = last.closing;
  if (!Number.isFinite(lastClose)) return null;

  const forecastMonths: RunwayForecastMonth[] = [];
  const running = emptyScenarioMap(lastClose);

  let y = last.year;
  let m = last.month + 1;
  if (m > 12) {
    m = 1;
    y += 1;
  }

  while (y === last.year && m <= 12) {
    const nets = {} as Record<RunwayScenarioId, number>;
    let missing = false;
    for (const id of RUNWAY_SCENARIO_ORDER) {
      const net = scenarioNet(y, m, id, freezeOwner);
      if (net == null) {
        missing = true;
        break;
      }
      nets[id] = net;
      running[id] = round2(running[id] + net);
    }
    if (missing) break;
    forecastMonths.push({
      year: y,
      month: m,
      label: forecastLabel(y, m),
      net: nets,
      close: { ...running },
    });
    m += 1;
  }

  const labels = [
    ...months.map((row) => row.label),
    ...forecastMonths.map((row) => row.label),
  ];
  const actual: Array<number | null> = [
    ...months.map((row) => row.closing),
    ...forecastMonths.map(() => null),
  ];

  const scenarios = emptyScenarioMap<Array<number | null>>([]);
  for (const id of RUNWAY_SCENARIO_ORDER) {
    const series: Array<number | null> = months.map(() => null);
    if (forecastMonths.length > 0) {
      series[series.length - 1] = lastClose;
    }
    for (const row of forecastMonths) {
      series.push(row.close[id]);
    }
    scenarios[id] = series;
  }

  const firstBelowZero = emptyScenarioMap<string | null>(null);
  const yearEnd = emptyScenarioMap(lastClose);
  const minFromNow = emptyScenarioMap(lastClose);
  for (const id of RUNWAY_SCENARIO_ORDER) {
    yearEnd[id] = forecastMonths.length
      ? forecastMonths[forecastMonths.length - 1].close[id]
      : lastClose;
    let min = lastClose;
    for (const row of forecastMonths) {
      min = Math.min(min, row.close[id]);
      if (firstBelowZero[id] == null && row.close[id] < 0) {
        firstBelowZero[id] = row.label;
      }
    }
    minFromNow[id] = min;
  }

  return {
    labels,
    actual,
    scenarios,
    forecastMonths,
    lastActualLabel: last.label,
    lastActualClose: lastClose,
    firstBelowZero,
    yearEnd,
    minFromNow,
  };
}

export function runwayUntilLabel(
  runway: CashflowRunway,
  id: RunwayScenarioId
): string {
  const hit = runway.firstBelowZero[id];
  if (hit) {
    const month = hit.replace(/\s+\d{4}$/, "").toLowerCase();
    if (runway.minFromNow[id] < 0 && runway.forecastMonths[0]?.close[id] < 0) {
      return `< 1 mes. (${month})`;
    }
    return hit;
  }
  if (runway.minFromNow[id] < CASHFLOW_RUNWAY_BUFFER_EUR) {
    return "do 31. 12., pod 3 k€";
  }
  return "do 31. 12.";
}
