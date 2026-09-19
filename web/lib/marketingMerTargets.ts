/** CEO MER scorecard targets — uprav podľa mesačného plánu. */
export type MerScorecardTargets = {
  revenue: number;
  total_mkt_spend: number;
  total_media_spend: number;
  agency_fees: number;
  blended_pno_pct: number;
  media_roas: number;
  mer: number;
};

export const MER_SCORECARD_DEFAULT_TARGETS: MerScorecardTargets = {
  revenue: 14_000,
  total_mkt_spend: 4_500,
  total_media_spend: 3_000,
  agency_fees: 1_500,
  blended_pno_pct: 20,
  media_roas: 3.0,
  mer: 3.5,
};

/** Mesačné ciele (EUR / % / ×). Chýbajúce polia doplní default. */
export const MER_MONTHLY_TARGETS: Record<string, Partial<MerScorecardTargets>> = {
  "2026-01": {
    revenue: 9_000,
    total_mkt_spend: 3_200,
    total_media_spend: 2_200,
    agency_fees: 1_200,
    blended_pno_pct: 20,
    media_roas: 2.5,
    mer: 3.5,
  },
  "2026-02": {
    revenue: 10_500,
    total_mkt_spend: 3_800,
    total_media_spend: 2_600,
    blended_pno_pct: 20,
    mer: 3.5,
  },
  "2026-03": {
    revenue: 11_500,
    total_mkt_spend: 4_000,
    total_media_spend: 2_800,
    blended_pno_pct: 20,
    mer: 3.5,
  },
  "2026-04": {
    revenue: 12_000,
    total_mkt_spend: 4_200,
    total_media_spend: 2_900,
    blended_pno_pct: 20,
    mer: 3.5,
  },
  "2026-05": {
    revenue: 12_500,
    total_mkt_spend: 4_300,
    total_media_spend: 3_000,
    blended_pno_pct: 20,
    mer: 3.5,
  },
  "2026-06": {
    revenue: 13_000,
    total_mkt_spend: 4_400,
    total_media_spend: 3_100,
    blended_pno_pct: 20,
    mer: 3.5,
  },
  "2026-07": {
    revenue: 14_000,
    total_mkt_spend: 4_500,
    total_media_spend: 3_200,
    blended_pno_pct: 20,
    mer: 3.5,
  },
  "2026-08": {
    revenue: 14_500,
    total_mkt_spend: 4_600,
    total_media_spend: 3_300,
    blended_pno_pct: 20,
    mer: 3.5,
  },
  "2026-09": {
    revenue: 15_000,
    total_mkt_spend: 4_700,
    total_media_spend: 3_400,
    blended_pno_pct: 20,
    mer: 3.5,
  },
};

export function getMerTargetsForMonth(ym: string): MerScorecardTargets {
  const override = MER_MONTHLY_TARGETS[ym] ?? {};
  return { ...MER_SCORECARD_DEFAULT_TARGETS, ...override };
}
