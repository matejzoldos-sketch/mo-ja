/** YYYY-MM-DD in UTC (date-only, no timezone shift). */
function parseYmd(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  return new Date(Date.UTC(y, mo - 1, d));
}

function formatYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const MS_PER_DAY = 86_400_000;

/** Same-length window immediately before [from, to] (inclusive). */
export function previousPeriodBounds(
  from: string,
  to: string
): { from: string; to: string } | null {
  const fromDate = parseYmd(from);
  const toDate = parseYmd(to);
  if (!fromDate || !toDate || toDate < fromDate) return null;

  const durationDays =
    Math.round((toDate.getTime() - fromDate.getTime()) / MS_PER_DAY) + 1;
  const prevTo = new Date(fromDate.getTime() - MS_PER_DAY);
  const prevFrom = new Date(prevTo.getTime() - (durationDays - 1) * MS_PER_DAY);

  return { from: formatYmd(prevFrom), to: formatYmd(prevTo) };
}

function formatSkShortDate(iso: string): string {
  const d = parseYmd(iso);
  if (!d) return iso;
  return d.toLocaleDateString("sk-SK", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatSkDayMonth(iso: string): string {
  const d = parseYmd(iso);
  if (!d) return iso;
  return d.toLocaleDateString("sk-SK", {
    day: "numeric",
    month: "numeric",
    timeZone: "UTC",
  });
}

/** Krátky popis predchádzajúceho okna pre scorecards. */
export function previousPeriodLabel(from: string, to: string): string {
  const fromD = parseYmd(from);
  const toD = parseYmd(to);
  if (!fromD || !toD) return "Predch. obdobie";

  const sameYear = fromD.getUTCFullYear() === toD.getUTCFullYear();
  const sameMonth =
    sameYear && fromD.getUTCMonth() === toD.getUTCMonth();
  const isFullYear =
    fromD.getUTCMonth() === 0 &&
    fromD.getUTCDate() === 1 &&
    toD.getUTCMonth() === 11 &&
    toD.getUTCDate() === 31;
  const isFullMonth =
    fromD.getUTCDate() === 1 &&
    toD.getUTCDate() ===
      new Date(
        Date.UTC(fromD.getUTCFullYear(), fromD.getUTCMonth() + 1, 0)
      ).getUTCDate();

  if (isFullYear) return `Rok ${fromD.getUTCFullYear()}`;
  if (isFullMonth && sameMonth) {
    const label = fromD.toLocaleDateString("sk-SK", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  if (sameYear && sameMonth) {
    return `${fromD.getUTCDate()}. – ${formatSkShortDate(to)}`;
  }
  if (sameYear) {
    return `${formatSkDayMonth(from)} – ${formatSkShortDate(to)}`;
  }
  return `${formatSkShortDate(from)} – ${formatSkShortDate(to)}`;
}

export type KpiDeltaDirection = "up" | "down" | "flat";

export function kpiDelta(
  current: number | null | undefined,
  previous: number | null | undefined
): {
  direction: KpiDeltaDirection;
  pct: number | null;
  abs: number | null;
} {
  if (
    current === null ||
    current === undefined ||
    previous === null ||
    previous === undefined ||
    Number.isNaN(Number(current)) ||
    Number.isNaN(Number(previous))
  ) {
    return { direction: "flat", pct: null, abs: null };
  }
  const c = Number(current);
  const p = Number(previous);
  const abs = c - p;
  if (Math.abs(abs) < 1e-9) {
    return { direction: "flat", pct: 0, abs: 0 };
  }
  const pct = p !== 0 ? (abs / Math.abs(p)) * 100 : null;
  return { direction: abs > 0 ? "up" : "down", pct, abs };
}
