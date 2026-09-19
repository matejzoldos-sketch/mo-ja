import { currentCalendarYm } from "@/lib/dashboardPeriodFilter";

export type MerScorecardMode = "completed" | "mtd";

export type MerTargetTone = "green" | "orange" | "red" | "neutral";

export type MerTargetStatus = {
  fulfillmentPct: number | null;
  tone: MerTargetTone;
  exceeded: boolean;
};

function bratislavaYm(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bratislava",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  if (!y || !m) return currentCalendarYm();
  return `${y}-${m}`;
}

/** Posledný ukončený kalendárny mesiac (Europe/Bratislava). */
export function lastCompletedCalendarYm(): string {
  const cur = bratislavaYm();
  const [y, m] = cur.split("-").map(Number);
  if (!y || !m) return cur;
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function resolveScorecardMonth(mode: MerScorecardMode): string {
  return mode === "mtd" ? bratislavaYm() : lastCompletedCalendarYm();
}

export function scorecardFulfillment(
  value: number | null | undefined,
  target: number | null | undefined,
  lowerIsBetter: boolean
): MerTargetStatus {
  if (
    value == null ||
    target == null ||
    !Number.isFinite(value) ||
    !Number.isFinite(target) ||
    target <= 0
  ) {
    return { fulfillmentPct: null, tone: "neutral", exceeded: false };
  }

  const fulfillmentPct = (value / target) * 100;
  const exceeded = lowerIsBetter ? value > target : false;

  if (lowerIsBetter) {
    if (exceeded) {
      return { fulfillmentPct, tone: "red", exceeded: true };
    }
    if (fulfillmentPct <= 95) {
      return { fulfillmentPct, tone: "green", exceeded: false };
    }
    if (fulfillmentPct <= 100) {
      return { fulfillmentPct, tone: "orange", exceeded: false };
    }
    return { fulfillmentPct, tone: "red", exceeded: true };
  }

  if (fulfillmentPct >= 95) {
    return { fulfillmentPct, tone: "green", exceeded: false };
  }
  if (fulfillmentPct >= 80) {
    return { fulfillmentPct, tone: "orange", exceeded: false };
  }
  return { fulfillmentPct, tone: "red", exceeded: false };
}

export function targetProgressWidth(
  status: MerTargetStatus,
  lowerIsBetter: boolean
): number {
  if (status.fulfillmentPct == null) return 0;
  if (lowerIsBetter) {
    if (status.exceeded) return 100;
    return Math.min(100, status.fulfillmentPct);
  }
  return Math.min(100, status.fulfillmentPct);
}
