"use client";

import { useEffect, useRef, useState } from "react";
import {
  listAvailableMonths,
  periodFilterLabel,
  periodFiltersEqual,
  ROLLING_RANGE_LABELS,
  ROLLING_RANGE_ORDER,
  type PeriodFilter,
  type RollingRangeKey,
} from "@/lib/dashboardPeriodFilter";

type Props = {
  period: PeriodFilter;
  onChange: (next: PeriodFilter) => void;
  /** Predvolené poradie rolling okien; default 30d → 90d → 365d */
  rangeOrder?: readonly RollingRangeKey[];
  className?: string;
  ariaLabel?: string;
};

export function PeriodFilterMenu({
  period,
  onChange,
  rangeOrder = ROLLING_RANGE_ORDER,
  className = "period-filter period-filter--range",
  ariaLabel = "Obdobie",
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const months = listAvailableMonths();

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pickRolling(next: RollingRangeKey) {
    setOpen(false);
    onChange({ range: next });
  }

  function pickMonth(ym: string) {
    setOpen(false);
    onChange({ range: "month", month: ym });
  }

  return (
    <div className={className} ref={ref}>
      <button
        type="button"
        className="period-filter__select period-filter__select--range-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{periodFilterLabel(period)}</span>
        <span className="period-filter__chevron" aria-hidden>
          ▼
        </span>
      </button>
      {open ? (
        <ul
          className="period-filter__range-list period-filter__range-list--with-months"
          role="listbox"
          aria-label={ariaLabel}
        >
          {rangeOrder.map((v) => {
            const candidate: PeriodFilter = { range: v };
            const selected = periodFiltersEqual(period, candidate);
            return (
              <li key={v} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={
                    selected
                      ? "period-filter__range-option is-selected"
                      : "period-filter__range-option"
                  }
                  onClick={() => pickRolling(v)}
                >
                  {selected ? "✓ " : ""}
                  {ROLLING_RANGE_LABELS[v]}
                </button>
              </li>
            );
          })}
          <li className="period-filter__range-separator" role="separator" aria-hidden>
            Kalendárne mesiace
          </li>
          {months.map((ym) => {
            const candidate: PeriodFilter = { range: "month", month: ym };
            const selected = periodFiltersEqual(period, candidate);
            return (
              <li key={ym} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={
                    selected
                      ? "period-filter__range-option is-selected"
                      : "period-filter__range-option"
                  }
                  onClick={() => pickMonth(ym)}
                >
                  {selected ? "✓ " : ""}
                  {periodFilterLabel(candidate)}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
