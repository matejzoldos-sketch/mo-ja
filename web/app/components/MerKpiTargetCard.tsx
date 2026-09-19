"use client";

import { KpiPeriodCompare } from "./KpiPeriodCompare";
import {
  classifyRevenuePnl,
  MER_REVENUE_BREAK_EVEN_NOTE,
  type MerRevenuePnlZone,
} from "@/lib/marketingMerTargets";
import {
  scorecardGoalFulfillment,
  scorecardWithinLimit,
  targetProgressWidth,
  type MerTargetTone,
} from "@/lib/marketingMerScorecard";

const REVENUE_PNL_LABELS: Record<MerRevenuePnlZone, string> = {
  profit: "🟢 ZISKOVÉ P&L",
  below_be: "🟠 POD BODOM ZVRATU",
  loss: "🔴 STRATOVÉ P&L",
};

const REVENUE_PNL_BADGE_CLASS: Record<MerRevenuePnlZone, string> = {
  profit: "mer-limit-badge--ok",
  below_be: "mer-limit-badge--warn",
  loss: "mer-limit-badge--over",
};

const TONE_COLORS: Record<MerTargetTone, string> = {
  green: "var(--clr-green, #16a34a)",
  orange: "var(--clr-amber, #ca8a04)",
  red: "var(--clr-red, #dc2626)",
  neutral: "rgba(26, 31, 40, 0.25)",
};

export type MerKpiTargetDisplay = "goal" | "limit" | "revenue";

type MerKpiTargetCardProps = {
  label: string;
  value: number | null;
  target: number | null;
  formatValue: (v: number) => string;
  formatTarget: (v: number) => string;
  /** goal = výnosové (≥, progress); limit = nákladové (≤, badge) */
  display?: MerKpiTargetDisplay;
  current?: number | null;
  previous?: number | null;
  compareFormatValue?: (v: number) => string;
  higherIsBetterCompare?: boolean;
  periodLabel?: string;
  showMtdBadge?: boolean;
  /** Text v badge, napr. „max 18 %“. */
  limitCaption?: string;
  /** Doplňujúci riadok pod badge (napr. limit v €). */
  limitDetail?: string | null;
};

export function MerKpiTargetCard({
  label,
  value,
  target,
  formatValue,
  formatTarget,
  display = "goal",
  current,
  previous,
  compareFormatValue,
  higherIsBetterCompare,
  periodLabel,
  showMtdBadge,
  limitCaption,
  limitDetail,
}: MerKpiTargetCardProps) {
  const showGoalProgress = display === "goal" || display === "revenue";
  const goalStatus =
    showGoalProgress ? scorecardGoalFulfillment(value, target) : null;
  const revenuePnl =
    display === "revenue" ? classifyRevenuePnl(value) : null;
  const barWidth =
    goalStatus != null ? targetProgressWidth(goalStatus) : 0;
  const withinLimit =
    display === "limit" &&
    value != null &&
    target != null &&
    scorecardWithinLimit(value, target);

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
      {target != null && showGoalProgress ? (
        <div className="mer-target-meta">
          <span className="mer-target-meta__line">
            Cieľ ≥ {formatTarget(target)}
            {goalStatus?.fulfillmentPct != null ? (
              <span className="mer-target-meta__pct">
                {" "}
                · {goalStatus.fulfillmentPct.toFixed(0)} %
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
                backgroundColor: TONE_COLORS[goalStatus?.tone ?? "neutral"],
              }}
            />
          </div>
        </div>
      ) : null}
      {display === "revenue" && revenuePnl != null ? (
        <div className="mer-limit-meta">
          <span
            className={`mer-limit-badge ${REVENUE_PNL_BADGE_CLASS[revenuePnl]}`}
            title={MER_REVENUE_BREAK_EVEN_NOTE}
          >
            {REVENUE_PNL_LABELS[revenuePnl]}
          </span>
          <span className="mer-limit-meta__text mer-revenue-footnote">
            {MER_REVENUE_BREAK_EVEN_NOTE}
          </span>
        </div>
      ) : null}
      {target != null && display === "limit" && value != null ? (
        <div className="mer-limit-meta">
          <span
            className={`mer-limit-badge${
              withinLimit ? " mer-limit-badge--ok" : " mer-limit-badge--over"
            }`}
          >
            {withinLimit ? "🟢 V NORME" : "🔴 PREKROČENÉ"}
            {limitCaption ? ` (${limitCaption})` : ""}
          </span>
          {limitDetail ? (
            <span className="mer-limit-meta__text">{limitDetail}</span>
          ) : !limitCaption ? (
            <span className="mer-limit-meta__text">
              (Max limit: {formatTarget(target)})
            </span>
          ) : null}
        </div>
      ) : null}
      {target != null && display === "limit" && value == null ? (
        <div className="mer-limit-meta">
          <span className="mer-limit-meta__text">
            {limitCaption
              ? `(${limitCaption})`
              : `(Max limit: ${formatTarget(target)})`}
          </span>
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
