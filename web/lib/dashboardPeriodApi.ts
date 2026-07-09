import {
  isValidMonthYm,
  parsePeriodFilter,
  type PeriodFilter,
} from "@/lib/dashboardPeriodFilter";

export function resolvePeriodFromSearchParams(
  searchParams: URLSearchParams,
  options?: { defaultRange?: PeriodFilter["range"] }
): PeriodFilter {
  return parsePeriodFilter(
    searchParams.get("range"),
    searchParams.get("month"),
    options
  );
}

export function periodToRpcPayload(period: PeriodFilter): {
  p_range: string;
  p_month?: string;
} {
  if (period.range === "month") {
    const month = period.month?.trim();
    if (isValidMonthYm(month)) {
      return { p_range: "month", p_month: month };
    }
    return { p_range: "month" };
  }
  return { p_range: period.range };
}
