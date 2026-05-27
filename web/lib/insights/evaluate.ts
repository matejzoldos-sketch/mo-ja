import { INSIGHT_THRESHOLDS } from "./config";
import type {
  Daily,
  Insight,
  InsightSeverity,
  PurchaseCountBucket,
  SkuDaily,
  DashboardPayload,
} from "./types";

function fmtMoney(amount: number, currency: string | null): string {
  const c = currency || "EUR";
  try {
    return new Intl.NumberFormat("sk-SK", {
      style: "currency",
      currency: c,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${c}`;
  }
}

function fmtPct(pct: number, digits = 1): string {
  return `${pct.toLocaleString("sk-SK", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} %`;
}

function severityScore(s: InsightSeverity): number {
  if (s === "critical") return 100;
  if (s === "warning") return 60;
  return 30;
}

function sumRevenue(rows: Daily[]): number {
  return rows.reduce((s, r) => s + Number(r.revenue || 0), 0);
}

function lastNDays(rows: Daily[], n: number): Daily[] {
  if (rows.length <= n) return rows.slice();
  return rows.slice(rows.length - n);
}

function prevNDays(rows: Daily[], n: number): Daily[] {
  if (rows.length <= n * 2) return rows.slice(0, Math.max(0, rows.length - n));
  return rows.slice(rows.length - n * 2, rows.length - n);
}

function pctChange(prev: number, cur: number): number | null {
  if (!Number.isFinite(prev) || prev <= 0) return null;
  return ((cur - prev) / prev) * 100;
}

function oneTimePct(buckets: PurchaseCountBucket[] | undefined): number | null {
  if (!buckets?.length) return null;
  const b1 = buckets.find((b) => Number(b.bucket) === 1);
  if (!b1) return null;
  const pct = Number(b1.pct);
  return Number.isFinite(pct) ? pct : null;
}

function safeNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
}

function skuUnitsDeltaPct(sku: SkuDaily | undefined, windowDays = 14): {
  sku: string;
  prev: number;
  cur: number;
  pct: number | null;
} | null {
  if (!sku?.points?.length) return null;
  const byDate = new Map<string, Map<string, number>>();
  for (const p of sku.points) {
    const d = String(p.date);
    const s = String(p.sku);
    const u = Number(p.units || 0);
    if (!byDate.has(d)) byDate.set(d, new Map());
    byDate.get(d)!.set(s, (byDate.get(d)!.get(s) ?? 0) + u);
  }
  const dates = Array.from(byDate.keys()).sort();
  if (dates.length < windowDays * 2) return null;
  const last = dates.slice(dates.length - windowDays);
  const prev = dates.slice(dates.length - windowDays * 2, dates.length - windowDays);

  const totalFor = (ds: string[]): Map<string, number> => {
    const out = new Map<string, number>();
    for (const d of ds) {
      const m = byDate.get(d);
      if (!m) continue;
      Array.from(m.entries()).forEach(([skuName, units]) => {
        out.set(skuName, (out.get(skuName) ?? 0) + units);
      });
    }
    return out;
  };

  const curTotals = totalFor(last);
  const prevTotals = totalFor(prev);
  if (curTotals.size === 0) return null;

  // Pick most-sold SKU in current window.
  let bestSku = "";
  let bestCur = -1;
  Array.from(curTotals.entries()).forEach(([s, u]) => {
    if (u > bestCur) {
      bestSku = s;
      bestCur = u;
    }
  });
  if (!bestSku) return null;
  const curUnits = Number(curTotals.get(bestSku) ?? 0);
  const prevUnits = Number(prevTotals.get(bestSku) ?? 0);
  return {
    sku: bestSku,
    prev: prevUnits,
    cur: curUnits,
    pct: pctChange(prevUnits, curUnits),
  };
}

export function evaluateInsights(input: {
  range: string;
  kpiProduct: string;
  dashboard: DashboardPayload;
  skuDailyYtd?: SkuDaily;
}): { risks: Insight[]; opportunities: Insight[] } {
  const { range, kpiProduct, dashboard, skuDailyYtd } = input;
  const cur = dashboard.kpis.currency;
  const periodHref =
    kpiProduct && kpiProduct !== "all"
      ? `/?range=${encodeURIComponent(range)}&kpi_product=${encodeURIComponent(kpiProduct)}`
      : `/?range=${encodeURIComponent(range)}`;

  const insights: Insight[] = [];

  // Revenue: last 14 days vs previous 14 days inside the window.
  const daily = Array.isArray(dashboard.dailyRevenue) ? dashboard.dailyRevenue : [];
  const last14 = lastNDays(daily, 14);
  const prev14 = prevNDays(daily, 14);
  const last14Sum = sumRevenue(last14);
  const prev14Sum = sumRevenue(prev14);
  const rev14Pct = pctChange(prev14Sum, last14Sum);
  if (rev14Pct != null) {
    if (rev14Pct <= -INSIGHT_THRESHOLDS.revenue14dDeclinePctWarn) {
      const sev: InsightSeverity =
        rev14Pct <= -INSIGHT_THRESHOLDS.revenue14dDeclinePctCritical
          ? "critical"
          : "warning";
      insights.push({
        id: "revenue_14d_decline",
        kind: "risk",
        severity: sev,
        score: severityScore(sev) + Math.min(40, Math.abs(rev14Pct)),
        title: "Tržby v posledných 14 dňoch klesajú",
        body: `Posledných 14 dní ${fmtPct(rev14Pct)} vs. predchádzajúcich 14 dní (${fmtMoney(prev14Sum, cur)} → ${fmtMoney(last14Sum, cur)}).`,
        metric: { label: "Δ tržby (14d)", value: fmtPct(rev14Pct) },
        link: { href: periodHref, label: "Otvoriť predaj" },
      });
    } else if (rev14Pct >= INSIGHT_THRESHOLDS.revenue14dGrowthPct) {
      insights.push({
        id: "revenue_14d_growth",
        kind: "opportunity",
        severity: "info",
        score: 35 + Math.min(30, rev14Pct),
        title: "Tržby v posledných 14 dňoch rastú",
        body: `Posledných 14 dní +${fmtPct(rev14Pct)} vs. predchádzajúcich 14 dní (${fmtMoney(prev14Sum, cur)} → ${fmtMoney(last14Sum, cur)}).`,
        metric: { label: "Δ tržby (14d)", value: `+${fmtPct(rev14Pct)}` },
        link: { href: periodHref, label: "Otvoriť predaj" },
      });
    }
  }

  // Returning customers %.
  const returning = safeNum(dashboard.kpis.returning_customers_pct);
  if (returning != null) {
    if (returning < INSIGHT_THRESHOLDS.returningPctLowWarn) {
      const sev: InsightSeverity =
        returning < INSIGHT_THRESHOLDS.returningPctLowCritical
          ? "critical"
          : "warning";
      insights.push({
        id: "returning_low",
        kind: "risk",
        severity: sev,
        score: severityScore(sev) + (INSIGHT_THRESHOLDS.returningPctLowWarn - returning),
        title: "Nízký podiel opakovaných zákazníkov",
        body: `Opakovaní zákazníci (2+ objednávky) tvoria ${fmtPct(returning)}. Skús posilniť „druhý nákup“ (email, bundle, reminder).`,
        metric: { label: "Opakovaní", value: fmtPct(returning) },
        link: { href: periodHref, label: "Otvoriť predaj" },
      });
    } else if (returning >= INSIGHT_THRESHOLDS.returningPctHigh) {
      insights.push({
        id: "returning_high",
        kind: "opportunity",
        severity: "info",
        score: 40 + Math.min(20, returning - INSIGHT_THRESHOLDS.returningPctHigh),
        title: "Silná retencia",
        body: `Opakovaní zákazníci (2+ objednávky) tvoria ${fmtPct(returning)}. Zváž loyalty / referral, aby si trend udržal.`,
        metric: { label: "Opakovaní", value: fmtPct(returning) },
        link: { href: periodHref, label: "Otvoriť predaj" },
      });
    }
  }

  // One-time buyers share.
  const onePct = oneTimePct(dashboard.purchaseCountDistribution);
  if (onePct != null) {
    if (onePct >= INSIGHT_THRESHOLDS.oneTimeBuyerPctHigh) {
      insights.push({
        id: "one_time_high",
        kind: "risk",
        severity: "warning",
        score: 60 + Math.min(25, onePct - INSIGHT_THRESHOLDS.oneTimeBuyerPctHigh),
        title: "Veľa jednorazových zákazníkov",
        body: `${fmtPct(onePct)} zákazníkov v období má len 1 nákup. Najväčšia páka je druhý nákup (sekvencia po doručení, edukácia, upsell).`,
        metric: { label: "1× nákup", value: fmtPct(onePct) },
        link: { href: periodHref, label: "Otvoriť predaj" },
      });
    } else if (onePct <= INSIGHT_THRESHOLDS.oneTimeBuyerPctLow) {
      insights.push({
        id: "one_time_low",
        kind: "opportunity",
        severity: "info",
        score: 40 + Math.min(15, INSIGHT_THRESHOLDS.oneTimeBuyerPctLow - onePct),
        title: "Dobrý podiel opakovaných nákupov",
        body: `Jednorazové nákupy tvoria len ${fmtPct(onePct)}. To je dobrý základ na škálovanie akvizície bez výraznej straty v LTV.`,
        metric: { label: "1× nákup", value: fmtPct(onePct) },
        link: { href: periodHref, label: "Otvoriť predaj" },
      });
    }
  }

  // Avg days between first and second purchase.
  const days12 = safeNum(dashboard.kpis.avg_days_first_to_second_purchase);
  if (days12 != null) {
    if (days12 >= INSIGHT_THRESHOLDS.avgDaysFirstSecondHigh) {
      insights.push({
        id: "first_second_slow",
        kind: "risk",
        severity: "info",
        score: 35 + Math.min(20, (days12 - INSIGHT_THRESHOLDS.avgDaysFirstSecondHigh) / 2),
        title: "Druhý nákup prichádza pomaly",
        body: `Priemer medzi 1. a 2. nákupom je ${days12.toLocaleString("sk-SK", {
          maximumFractionDigits: 1,
        })} dní. Pomôže sekvencia po prvom nákupe a jasný dôvod vrátiť sa.`,
        metric: { label: "1.→2. nákup", value: `${days12.toFixed(1)} dní` },
        link: { href: periodHref, label: "Otvoriť predaj" },
      });
    } else if (days12 <= INSIGHT_THRESHOLDS.avgDaysFirstSecondGood) {
      insights.push({
        id: "first_second_fast",
        kind: "opportunity",
        severity: "info",
        score: 45 + Math.min(15, (INSIGHT_THRESHOLDS.avgDaysFirstSecondGood - days12) / 2),
        title: "Zákazníci sa vracajú rýchlo",
        body: `Priemer medzi 1. a 2. nákupom je ${days12.toLocaleString("sk-SK", {
          maximumFractionDigits: 1,
        })} dní. Toto je silný signál product-market fit; oplatí sa škálovať kanály.`,
        metric: { label: "1.→2. nákup", value: `${days12.toFixed(1)} dní` },
        link: { href: periodHref, label: "Otvoriť predaj" },
      });
    }
  }

  // SKU units delta for most-sold SKU in last 14 days.
  const skuDelta = skuUnitsDeltaPct(skuDailyYtd, 14);
  if (skuDelta?.pct != null) {
    if (skuDelta.pct <= -INSIGHT_THRESHOLDS.skuUnitsDeltaPctWarn) {
      insights.push({
        id: "sku_units_drop",
        kind: "risk",
        severity: "warning",
        score: 65 + Math.min(25, Math.abs(skuDelta.pct)),
        title: "Najpredávanejší produkt spomaľuje",
        body: `${skuDelta.sku}: kusy za posledných 14 dní ${fmtPct(
          skuDelta.pct
        )} vs. predchádzajúcich 14 dní (${skuDelta.prev} → ${skuDelta.cur}).`,
        metric: { label: "Δ kusy (14d)", value: fmtPct(skuDelta.pct) },
        link: { href: periodHref, label: "Otvoriť predaj" },
      });
    } else if (skuDelta.pct >= INSIGHT_THRESHOLDS.skuUnitsDeltaPctGood) {
      insights.push({
        id: "sku_units_up",
        kind: "opportunity",
        severity: "info",
        score: 45 + Math.min(25, skuDelta.pct),
        title: "Najpredávanejší produkt rastie",
        body: `${skuDelta.sku}: kusy za posledných 14 dní +${fmtPct(
          skuDelta.pct
        )} vs. predchádzajúcich 14 dní (${skuDelta.prev} → ${skuDelta.cur}).`,
        metric: { label: "Δ kusy (14d)", value: `+${fmtPct(skuDelta.pct)}` },
        link: { href: periodHref, label: "Otvoriť predaj" },
      });
    }
  }

  // Fallback: always include a context card if too few.
  if (insights.length === 0) {
    insights.push({
      id: "no_strong_signals",
      kind: "opportunity",
      severity: "info",
      score: 10,
      title: "Bez výrazných signálov",
      body: "V dátach za zvolené obdobie nevidím silné odchýlky podľa základných pravidiel. Skús iné obdobie alebo produktový filter.",
      link: { href: periodHref, label: "Otvoriť predaj" },
    });
  }

  const risks = insights
    .filter((i) => i.kind === "risk")
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const opportunities = insights
    .filter((i) => i.kind === "opportunity")
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return { risks, opportunities };
}

