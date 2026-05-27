export const INSIGHTS_DEFAULT_RANGE = "90d" as const;

export const INSIGHT_THRESHOLDS = {
  revenue14dDeclinePctWarn: 10,
  revenue14dDeclinePctCritical: 20,
  revenue14dGrowthPct: 10,

  returningPctLowWarn: 20,
  returningPctLowCritical: 15,
  returningPctHigh: 30,

  oneTimeBuyerPctHigh: 55,
  oneTimeBuyerPctLow: 45,

  avgDaysFirstSecondHigh: 90,
  avgDaysFirstSecondGood: 30,

  skuUnitsDeltaPctWarn: 30,
  skuUnitsDeltaPctGood: 25,

  stockoutWarnDays: 14,
  stockoutCriticalDays: 7,
  slowMoverMinAvailable: 30,
  slowMoverMaxDailyUnits: 0.05,
} as const;

