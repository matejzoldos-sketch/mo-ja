export type RollingRangeKey = "30d" | "90d" | "365d";
export type DashboardRangeKey = RollingRangeKey | "month";

/** Prvý mesiac s predajom (od spustenia MOJA). */
export const DASHBOARD_LAUNCH_YM = "2025-11";

export type PeriodFilter = {
  range: DashboardRangeKey;
  /** YYYY-MM — platné keď range === "month" */
  month?: string;
};

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const ROLLING_RANGE_LABELS: Record<RollingRangeKey, string> = {
  "30d": "Posledných 30 dní",
  "90d": "Posledných 90 dní",
  "365d": "Od spustenia (Nov 2025 – Súčasnosť)",
};

export const ROLLING_RANGE_ORDER: readonly RollingRangeKey[] = [
  "30d",
  "90d",
  "365d",
];

function currentYm(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function parseYm(ym: string): { y: number; m: number } | null {
  if (!MONTH_RE.test(ym)) return null;
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return null;
  return { y, m };
}

function addMonth(y: number, m: number): { y: number; m: number } {
  if (m === 12) return { y: y + 1, m: 1 };
  return { y, m: m + 1 };
}

/** Kalendárne mesiace od spustenia po aktuálny mesiac, najnovší prvý. */
export function listAvailableMonths(
  fromYm: string = DASHBOARD_LAUNCH_YM
): string[] {
  const start = parseYm(fromYm);
  const end = parseYm(currentYm());
  if (!start || !end) return [];

  const out: string[] = [];
  let { y, m } = start;
  while (y < end.y || (y === end.y && m <= end.m)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    ({ y, m } = addMonth(y, m));
  }
  return out.reverse();
}

export function formatMonthLabelSk(ym: string): string {
  const p = parseYm(ym);
  if (!p) return ym;
  const d = new Date(Date.UTC(p.y, p.m - 1, 1));
  const label = d.toLocaleDateString("sk-SK", {
    month: "long",
    year: "numeric",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function isValidMonthYm(raw: string | null | undefined): raw is string {
  return typeof raw === "string" && MONTH_RE.test(raw.trim());
}

export function parseRollingRangeParam(
  raw: string | null,
  fallback: RollingRangeKey = "365d"
): RollingRangeKey {
  const s = (raw || "").toLowerCase().trim();
  if (s === "ytd" || s === "all" || s === "365d") return "365d";
  if (s === "30d" || s === "90d") return s;
  return fallback;
}

export function parsePeriodFilter(
  rangeRaw: string | null,
  monthRaw: string | null,
  options?: { defaultRange?: DashboardRangeKey }
): PeriodFilter {
  const defaultRange = options?.defaultRange ?? "365d";
  const rangeNorm = (rangeRaw || "").toLowerCase().trim();
  const month = isValidMonthYm(monthRaw) ? monthRaw.trim() : undefined;

  if (rangeNorm === "month" || month) {
    return {
      range: "month",
      month: month ?? currentYm(),
    };
  }

  if (rangeNorm === "30d" || rangeNorm === "90d") {
    return { range: rangeNorm };
  }
  if (
    rangeNorm === "365d" ||
    rangeNorm === "ytd" ||
    rangeNorm === "all" ||
    rangeNorm === ""
  ) {
    return { range: "365d" };
  }

  return { range: defaultRange };
}

export function periodFiltersEqual(a: PeriodFilter, b: PeriodFilter): boolean {
  if (a.range !== b.range) return false;
  if (a.range === "month") return a.month === b.month;
  return true;
}

export function periodFilterLabel(period: PeriodFilter): string {
  if (period.range === "month") {
    return formatMonthLabelSk(period.month ?? currentYm());
  }
  return ROLLING_RANGE_LABELS[period.range];
}

export function periodFilterToSearchParams(
  period: PeriodFilter,
  base?: URLSearchParams
): URLSearchParams {
  const params = new URLSearchParams(base?.toString() ?? "");
  if (period.range === "month") {
    params.set("range", "month");
    params.set("month", period.month ?? currentYm());
    return params;
  }
  params.set("range", period.range);
  params.delete("month");
  return params;
}

export function periodFilterApiQuery(period: PeriodFilter): string {
  if (period.range === "month") {
    const month = period.month ?? currentYm();
    return `range=month&month=${encodeURIComponent(month)}`;
  }
  return `range=${encodeURIComponent(period.range)}`;
}
