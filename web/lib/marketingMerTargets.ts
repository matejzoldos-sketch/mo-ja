/** CEO MER scorecard targets — break-even revenue + % limity z tržieb. */

export const MER_MKT_MAX_REVENUE_PCT = 18;
export const MER_PNO_MAX_PCT = 18;
export const MER_GOAL_MIN = 5.5;
export const MER_AGENCY_PCT_OF_MEDIA_MAX = 20;

/** Break-even / cieľ Revenue (ziskové P&L). */
export const MER_REVENUE_GOAL = 19_300;
export const MER_REVENUE_PNL_WARNING_MIN = 16_000;
export const MER_REVENUE_BREAK_EVEN_NOTE =
  "Break-even hranica pre ziskový P&L je 19 300 €";

export type MerRevenuePnlZone = "profit" | "below_be" | "loss";

export function classifyRevenuePnl(
  revenue: number | null | undefined
): MerRevenuePnlZone | null {
  if (revenue == null || !Number.isFinite(revenue)) return null;
  if (revenue >= MER_REVENUE_GOAL) return "profit";
  if (revenue >= MER_REVENUE_PNL_WARNING_MIN) return "below_be";
  return "loss";
}

export type MerScorecardTargets = {
  revenue: number;
  total_mkt_spend: number;
  total_media_spend: number;
  agency_fees: number;
  blended_pno_pct: number;
  media_roas: number;
  mer: number;
  agency_pct_of_media_max: number;
};

export const MER_SCORECARD_DEFAULT_TARGETS: Omit<
  MerScorecardTargets,
  "total_mkt_spend"
> & { total_mkt_spend?: number } = {
  revenue: MER_REVENUE_GOAL,
  total_media_spend: 3_000,
  agency_fees: 1_500,
  blended_pno_pct: MER_PNO_MAX_PCT,
  media_roas: 3.0,
  mer: MER_GOAL_MIN,
  agency_pct_of_media_max: MER_AGENCY_PCT_OF_MEDIA_MAX,
};

export function getMerTargetsForMonth(
  _ym: string,
  revenueActual?: number | null
): MerScorecardTargets {
  const revenueForMkt =
    revenueActual != null && revenueActual > 0
      ? revenueActual
      : MER_REVENUE_GOAL;

  return {
    revenue: MER_REVENUE_GOAL,
    total_mkt_spend: Math.round(
      (revenueForMkt * MER_MKT_MAX_REVENUE_PCT) / 100
    ),
    total_media_spend: MER_SCORECARD_DEFAULT_TARGETS.total_media_spend,
    agency_fees: MER_SCORECARD_DEFAULT_TARGETS.agency_fees,
    blended_pno_pct: MER_PNO_MAX_PCT,
    media_roas: MER_SCORECARD_DEFAULT_TARGETS.media_roas,
    mer: MER_GOAL_MIN,
    agency_pct_of_media_max: MER_AGENCY_PCT_OF_MEDIA_MAX,
  };
}
