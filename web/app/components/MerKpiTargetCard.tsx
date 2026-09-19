"use client";

import { KpiPeriodCompare } from "./KpiPeriodCompare";
import {
  scorecardFulfillment,
  targetProgressWidth,
  type MerTargetTone,
} from "@/lib/marketingMerScorecard";

const TONE_COLORS: Record<MerTargetTone, string> = {
  green: "var(--clr-green, #16a34a)",
  orange: "var(--clr-amber, #ca8a04)",
  red: "var(--clr-red, #dc2626)",
  neutral: "rgba(26, 31, 40, 0.25)",
};

type MerKpiTargetCardProps = {
  label: string;
  value: number | null;
  target: number | null;
  formatValue: (v: number) => string;
  formatTarget: (v: number) => string;
  lowerIsBetter?: boolean;
  targetPrefix?: string;
  current?: number | null;
  previous?: number | null;
  compareFormatValue?: (v: number) => string;
  higherIsBetterCompare?: boolean;
  periodLabel?: string;
  showMtdBadge?: boolean;
};

export function MerKpiTargetCard({
  label,
  value,
  target,
  formatValue,
  formatTarget,
  lowerIsBetter = false,
  targetPrefix,
  current,
  previous,
  compareFormatValue,
  higherIsBetterCompare,
  periodLabel,
  showMtdBadge,
}: MerKpiTargetCardProps) {
  const status = scorecardFulfillment(value, target, lowerIsBetter);
  const barWidth = targetProgressWidth(status, lowerIsBetter);
  const prefix = targetPrefix ?? (lowerIsBetter ? "≤" : "≥");

  return (
    <div className="kpi-card kpi-card--mer-target">
      <div className="kpi-card__label-row">
        <span className="kpi-card__label">{label}</span>
        {showMtdBadge ? (
          <span className="mer-mtd-badge" title="Priebežné dáta (MTD)">
            Priebežné dáta (MTD)
          </span>
        ) : null}
      </div>
      <strong className="kpi-card__value">
        {value == null ? "—" : formatValue(value)}
      </strong>
      {target != null ? (
        <div className="mer-target-meta">
          <span className="mer-target-meta__line">
            Cieľ {prefix} {formatTarget(target)}
            {status.fulfillmentPct != null ? (
              <span className="mer-target-meta__pct">
                {" "}
                · {status.fulfillmentPct.toFixed(0)} %
              </span>
            ) : null}
          </span>
          <div
            className="mer-target-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={barWidth}
            aria-label={`Plnenie cieľa ${label}`}
          >
            <div
              className="mer-target-bar__fill"
              style={{
                width: `${barWidth}%`,
                backgroundColor: TONE_COLORS[status.tone],
              }}
            />
          </div>
        </div>
      ) : null}
      {current != null && compareFormatValue ? (
        <KpiPeriodCompare
          current={current}
          previous={previous ?? undefined}
          formatValue={compareFormatValue}
          higherIsBetter={higherIsBetterCompare}
          periodLabel={periodLabel}
        />
      ) : null}
    </div>
  );
}
