import {
  isValidMonthYm,
  isValidYearY,
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
    searchParams.get("year"),
    options
  );
}

export function periodToRpcPayload(period: PeriodFilter): {
  p_range: string;
  p_month?: string;
  p_year?: string;
} {
  if (period.range === "month") {
    const month = period.month?.trim();
    if (isValidMonthYm(month)) {
      return { p_range: "month", p_month: month };
    }
    return { p_range: "month" };
  }
  if (period.range === "year") {
    const year = period.year?.trim();
    if (isValidYearY(year)) {
      return { p_range: "year", p_year: year };
    }
    return { p_range: "year" };
  }
  return { p_range: period.range };
}
