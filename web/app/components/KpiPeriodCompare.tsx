import { kpiDelta, type KpiDeltaDirection } from "@/lib/dashboardPeriodCompare";

type Props = {
  current: number | null | undefined;
  previous: number | null | undefined;
  formatValue: (value: number) => string;
  /** When false, down arrow is green (e.g. days between purchases). Default true. */
  higherIsBetter?: boolean;
  periodLabel?: string | null;
};

function arrowFor(direction: KpiDeltaDirection): string {
  if (direction === "up") return "↑";
  if (direction === "down") return "↓";
  return "→";
}

export function KpiPeriodCompare({
  current,
  previous,
  formatValue,
  higherIsBetter = true,
  periodLabel,
}: Props) {
  if (
    previous === null ||
    previous === undefined ||
    Number.isNaN(Number(previous))
  ) {
    return null;
  }

  const prevNum = Number(previous);
  const { direction, pct } = kpiDelta(current, previous);
  const improved =
    direction === "flat" ||
    (higherIsBetter ? direction === "up" : direction === "down");

  const pctLabel =
    pct !== null && Number.isFinite(pct) && Math.abs(pct) >= 0.5
      ? ` ${Math.abs(pct).toFixed(0)} %`
      : "";

  return (
    <div className="kpi-card__compare" title={periodLabel ?? undefined}>
      <span
        className={`kpi-card__delta${
          direction === "flat"
            ? " kpi-card__delta--flat"
            : improved
              ? " kpi-card__delta--good"
              : " kpi-card__delta--bad"
        }`}
        aria-hidden
      >
        {arrowFor(direction)}
        {pctLabel}
      </span>
      <span className="kpi-card__prev">
        {periodLabel ? (
          <span className="kpi-card__prev-label">{periodLabel}: </span>
        ) : null}
        {formatValue(prevNum)}
      </span>
    </div>
  );
}
