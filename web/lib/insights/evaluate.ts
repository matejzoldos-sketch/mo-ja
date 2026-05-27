import { INSIGHT_THRESHOLDS } from "./config";
import type {
  Daily,
  Insight,
  InsightSeverity,
  InventoryRow,
  PurchaseCountBucket,
  SkuDaily,
  DashboardPayload,
  MarketingBreakdownRow,
  MarketingPayload,
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

function daysUntil(isoYmd: string): number | null {
  const [y, m, d] = isoYmd.split("-").map(Number);
  if (!y || !m || !d) return null;
  const now = new Date();
  const todayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const targetUtc = new Date(Date.UTC(y, m - 1, d));
  const diffMs = targetUtc.getTime() - todayUtc.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function normalizeInventoryRows(levels: InventoryRow[] | undefined): InventoryRow[] {
  if (!Array.isArray(levels)) return [];
  return levels.filter(
    (r) => r && typeof r === "object" && typeof (r as InventoryRow).sku === "string"
  );
}

function normalizeMarketingPayload(m: MarketingPayload | undefined): MarketingPayload | null {
  if (!m || typeof m !== "object") return null;
  if (!m.meta || typeof m.meta !== "object") return null;
  if (!m.kpis || typeof m.kpis !== "object") return null;
  if (!Array.isArray(m.bySource)) return null;
  return m;
}

function pickUnknownRow(
  rows: MarketingBreakdownRow[] | undefined
): MarketingBreakdownRow | null {
  if (!Array.isArray(rows)) return null;
  const r = rows.find((x) => (x.label || "").toLowerCase().includes("neznámy"));
  return r ?? null;
}

function pickTopRow(
  rows: MarketingBreakdownRow[] | undefined,
  by: "revenue" | "orders" = "revenue"
): MarketingBreakdownRow | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const sorted = rows
    .slice()
    .filter((r) => Number.isFinite(Number(by === "revenue" ? r.revenue : r.orders)))
    .sort((a, b) => Number(b[by]) - Number(a[by]));
  return sorted[0] ?? null;
}

function isUnnamedCampaign(label: string | undefined): boolean {
  const s = (label || "").trim();
  return !s || s === "—" || s === "-" || s.toLowerCase() === "—";
}

function marketingLink(
  range: string,
  dim?: "source" | "medium" | "campaign"
): { href: string; label: string } {
  const base = `/marketing?range=${encodeURIComponent(range)}`;
  const href = dim ? `${base}&dim=${dim}` : base;
  return { href, label: "Otvoriť marketing" };
}

function marketingInsight(
  insight: Omit<Insight, "area"> & { area?: never }
): Insight {
  return { ...insight, area: "marketing" };
}

function inventoryInsight(
  insight: Omit<Insight, "area"> & { area?: never }
): Insight {
  return { ...insight, area: "inventory" };
}

function labelMatchesChannel(label: string, pattern: RegExp): boolean {
  return pattern.test((label || "").toLowerCase());
}

function pickOverstock(inv: InventoryRow[]): { r: InventoryRow; days: number } | null {
  const rows = inv
    .map((r) => {
      const days = safeNum(r.estimated_days_of_stock);
      return days == null ? null : { r, days };
    })
    .filter((x): x is { r: InventoryRow; days: number } => x != null)
    .filter(
      (x) =>
        x.days >= INSIGHT_THRESHOLDS.overstockWarnDays &&
        Number(x.r.available) >= INSIGHT_THRESHOLDS.overstockMinAvailable
    )
    .sort((a, b) => b.days - a.days);
  return rows[0] ?? null;
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
  inventoryLevels?: InventoryRow[];
  marketing?: MarketingPayload;
}): { risks: Insight[]; opportunities: Insight[] } {
  const { range, kpiProduct, dashboard, skuDailyYtd, inventoryLevels, marketing } =
    input;
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

  // Inventory (Sklad): stockout + out-of-stock with demand + slow movers.
  const inv = normalizeInventoryRows(inventoryLevels);
  if (inv.length > 0) {
    const withDemand = inv.filter((r) => (safeNum(r.avg_daily_units_sold_ytd) ?? 0) > 0);

    const zeroDemand = withDemand
      .filter((r) => Number(r.available) <= 0)
      .sort(
        (a, b) =>
          (safeNum(b.avg_daily_units_sold_ytd) ?? 0) -
          (safeNum(a.avg_daily_units_sold_ytd) ?? 0)
      )[0];

    if (zeroDemand) {
      const daily = safeNum(zeroDemand.avg_daily_units_sold_ytd) ?? 0;
      const name = zeroDemand.product_title?.trim() || zeroDemand.sku;
      insights.push(
        inventoryInsight({
          id: "stock_zero_with_demand",
          kind: "risk",
          severity: "critical",
          score: 120 + Math.min(50, daily * 10),
          title: "0 kusov pri existujúcom dopyte",
          body: `${name} má dostupnosť 0, ale historicky sa predáva ~${daily.toLocaleString(
            "sk-SK",
            { maximumFractionDigits: 2 }
          )} ks/deň (YTD).`,
          metric: { label: "Dostupné", value: "0 ks" },
          link: { href: "/sklad", label: "Otvoriť sklad" },
        })
      );
    }

    const soon = withDemand
      .map((r) => {
        const dd =
          typeof r.estimated_stockout_date === "string" && r.estimated_stockout_date
            ? daysUntil(r.estimated_stockout_date)
            : null;
        return dd == null ? null : { r, days: dd };
      })
      .filter(
        (x): x is { r: InventoryRow; days: number } => x != null && x.days >= 0
      )
      .sort((a, b) => a.days - b.days)[0];

    if (soon && soon.days <= INSIGHT_THRESHOLDS.stockoutWarnDays) {
      const sev: InsightSeverity =
        soon.days <= INSIGHT_THRESHOLDS.stockoutCriticalDays ? "critical" : "warning";
      const name = soon.r.product_title?.trim() || soon.r.sku;
      insights.push(
        inventoryInsight({
          id: "stockout_soon",
          kind: "risk",
          severity: sev,
          score:
            severityScore(sev) +
            Math.max(0, INSIGHT_THRESHOLDS.stockoutWarnDays - soon.days) * 4,
          title: "Hrozí vypredanie",
          body: `${name} pravdepodobne dôjde približne o ${soon.days} dní (odhad z YTD spotreby).`,
          metric: {
            label: "Stockout",
            value: soon.r.estimated_stockout_date ?? "—",
            delta: `${soon.days} dní`,
          },
          link: { href: "/sklad", label: "Otvoriť sklad" },
        })
      );
    }

    const over = pickOverstock(inv);
    if (over) {
      const name = over.r.product_title?.trim() || over.r.sku;
      insights.push(
        inventoryInsight({
          id: "overstock_days",
          kind: "opportunity",
          severity: "info",
          score: 55 + Math.min(30, (over.days - INSIGHT_THRESHOLDS.overstockWarnDays) / 30),
          title: "Veľmi vysoká zásoba",
          body: `${name} má približne ${Math.round(over.days)} dní zásoby (odhad) a ${
            Number(over.r.available)
          } ks dostupných. Zváž promo/bundle alebo úpravu ďalších doobjednaní.`,
          metric: { label: "Zásoba", value: `${Math.round(over.days)} dní` },
          link: { href: "/sklad", label: "Otvoriť sklad" },
        })
      );
    }

    const slow = inv
      .filter(
        (r) =>
          Number(r.available) >= INSIGHT_THRESHOLDS.slowMoverMinAvailable &&
          (safeNum(r.avg_daily_units_sold_ytd) ?? 0) <= INSIGHT_THRESHOLDS.slowMoverMaxDailyUnits
      )
      .sort((a, b) => Number(b.available) - Number(a.available))[0];

    if (slow) {
      const name = slow.product_title?.trim() || slow.sku;
      insights.push(
        inventoryInsight({
          id: "slow_mover_stock",
          kind: "opportunity",
          severity: "info",
          score: 35 + Math.min(20, Number(slow.available) / 10),
          title: "Pomalý tovar s vysokou zásobou",
          body: `${name} má ${Number(slow.available)} ks na sklade a veľmi nízky YTD odber. Zváž promo/bundle alebo zníženie ďalšieho doobjednania.`,
          metric: { label: "Dostupné", value: `${Number(slow.available)} ks` },
          link: { href: "/sklad", label: "Otvoriť sklad" },
        })
      );
    }
  }

  // Marketing UTM insights (only when viewing all products).
  if (kpiProduct === "all") {
    const m = normalizeMarketingPayload(marketing);
    if (m) {
      const orders = m.kpis.orders ?? 0;
      const withoutUtm = m.kpis.orders_without_utm ?? 0;
      const withoutUtmPct =
        orders > 0 ? (withoutUtm / orders) * 100 : null;
      const cov = safeNum(m.kpis.pct_orders_with_utm);

      if (cov != null && cov < INSIGHT_THRESHOLDS.utmCoverageWarnPct) {
        const sev: InsightSeverity =
          cov < INSIGHT_THRESHOLDS.utmCoverageCriticalPct ? "critical" : "warning";
        insights.push(
          marketingInsight({
            id: "utm_coverage_low",
            kind: "risk",
            severity: sev,
            score: severityScore(sev) + (INSIGHT_THRESHOLDS.utmCoverageWarnPct - cov),
            title: "Nízke pokrytie UTM atribúcie",
            body: `Len ${fmtPct(cov)} objednávok má UTM/journey atribúciu. Bez toho sa ťažko hodnotí výkon kanálov.`,
            metric: { label: "UTM coverage", value: fmtPct(cov) },
            link: marketingLink(range),
          })
        );
      } else if (cov != null && cov >= INSIGHT_THRESHOLDS.utmCoverageWarnPct) {
        insights.push(
          marketingInsight({
            id: "utm_coverage_ok",
            kind: "opportunity",
            severity: "info",
            score: 35 + Math.min(20, cov - INSIGHT_THRESHOLDS.utmCoverageWarnPct),
            title: "Dobré pokrytie UTM",
            body: `UTM/journey je dostupné pre ${fmtPct(cov)} objednávok. To je dobrý základ na optimalizáciu akvizície.`,
            metric: { label: "UTM coverage", value: fmtPct(cov) },
            link: marketingLink(range),
          })
        );
      }

      if (
        withoutUtmPct != null &&
        withoutUtmPct >= INSIGHT_THRESHOLDS.utmOrdersWithoutUtmWarnPct
      ) {
        insights.push(
          marketingInsight({
            id: "utm_orders_without_utm",
            kind: "risk",
            severity: withoutUtmPct >= 25 ? "warning" : "info",
            score: 50 + Math.min(30, withoutUtmPct - INSIGHT_THRESHOLDS.utmOrdersWithoutUtmWarnPct),
            title: "Veľa objednávok bez UTM",
            body: `${withoutUtm} z ${orders} objednávok (${fmtPct(withoutUtmPct)}) nemá priradené UTM. Skontroluj checkout a UTM parametre.`,
            metric: { label: "Bez UTM", value: fmtPct(withoutUtmPct) },
            link: marketingLink(range),
          })
        );
      }

      const unknown = pickUnknownRow(m.bySource);
      const unkRev = unknown ? safeNum(unknown.pct_revenue) : null;
      if (unknown && unkRev != null && unkRev >= INSIGHT_THRESHOLDS.utmUnknownRevenueWarnPct) {
        insights.push(
          marketingInsight({
            id: "utm_unknown_revenue_high",
            kind: "risk",
            severity: unkRev >= 25 ? "warning" : "info",
            score: 60 + Math.min(25, unkRev - INSIGHT_THRESHOLDS.utmUnknownRevenueWarnPct),
            title: "Vysoký podiel „Neznámy“ zdroj",
            body: `„Neznámy“ tvorí ${fmtPct(unkRev)} tržieb v atribúcii. Skontroluj UTM tagging (Meta, email, linky, QR).`,
            metric: { label: "Neznámy", value: fmtPct(unkRev) },
            link: marketingLink(range, "source"),
          })
        );
      }

      const topRevRow = pickTopRow(m.bySource, "revenue");
      const topRev = topRevRow ? safeNum(topRevRow.pct_revenue) : null;
      if (topRevRow && topRev != null && topRev >= INSIGHT_THRESHOLDS.utmChannelConcentrationWarnPct) {
        const sev: InsightSeverity =
          topRev >= INSIGHT_THRESHOLDS.utmChannelConcentrationCriticalPct
            ? "critical"
            : "warning";
        insights.push(
          marketingInsight({
            id: "utm_channel_concentration_revenue",
            kind: "risk",
            severity: sev,
            score:
              severityScore(sev) +
              Math.min(30, topRev - INSIGHT_THRESHOLDS.utmChannelConcentrationWarnPct),
            title: "Závislosť na jednom kanáli (tržby)",
            body: `${topRevRow.label} tvorí ${fmtPct(topRev)} tržieb. Pri výpadku kanála bude zásah veľký — zvaž rozšírenie mixu.`,
            metric: { label: "Top kanál", value: fmtPct(topRev) },
            link: marketingLink(range, "source"),
          })
        );
      }

      const topOrdRow = pickTopRow(m.bySource, "orders");
      const topOrdPct =
        topOrdRow && orders > 0
          ? (Number(topOrdRow.orders) / orders) * 100
          : null;
      if (
        topOrdRow &&
        topOrdPct != null &&
        topOrdPct >= INSIGHT_THRESHOLDS.utmChannelConcentrationOrdersWarnPct
      ) {
        insights.push(
          marketingInsight({
            id: "utm_channel_concentration_orders",
            kind: "risk",
            severity:
              topOrdPct >= INSIGHT_THRESHOLDS.utmChannelConcentrationCriticalPct
                ? "critical"
                : "warning",
            score:
              severityScore(
                topOrdPct >= INSIGHT_THRESHOLDS.utmChannelConcentrationCriticalPct
                  ? "critical"
                  : "warning"
              ) + Math.min(25, topOrdPct - INSIGHT_THRESHOLDS.utmChannelConcentrationOrdersWarnPct),
            title: "Závislosť na jednom kanáli (objednávky)",
            body: `${topOrdRow.label} tvorí ${fmtPct(topOrdPct)} objednávok. Diverzifikuj zdroje, aby výpadok jedného kanála nebol kritický.`,
            metric: { label: "Top kanál", value: fmtPct(topOrdPct) },
            link: marketingLink(range, "source"),
          })
        );
      }

      const campaigns = Array.isArray(m.byCampaign) ? m.byCampaign : [];
      const namedCampaigns = campaigns.filter((c) => !isUnnamedCampaign(c.label));
      const unnamed = campaigns.filter((c) => isUnnamedCampaign(c.label));
      const unnamedOrders = unnamed.reduce((s, c) => s + Number(c.orders || 0), 0);
      const unnamedOrderPct =
        orders > 0 ? (unnamedOrders / orders) * 100 : null;
      if (
        unnamedOrderPct != null &&
        unnamedOrderPct >= INSIGHT_THRESHOLDS.utmMissingCampaignOrdersWarnPct &&
        unnamedOrders >= 20
      ) {
        insights.push(
          marketingInsight({
            id: "utm_missing_campaign",
            kind: "risk",
            severity: unnamedOrderPct >= 40 ? "warning" : "info",
            score: 55 + Math.min(25, unnamedOrderPct - INSIGHT_THRESHOLDS.utmMissingCampaignOrdersWarnPct),
            title: "Chýba názov kampane",
            body: `${fmtPct(unnamedOrderPct)} objednávok (${unnamedOrders}) nemá vyplnenú kampaň v UTM. Doplň campaign v odkazoch a reklamách.`,
            metric: { label: "Bez kampane", value: fmtPct(unnamedOrderPct) },
            link: marketingLink(range, "campaign"),
          })
        );
      }

      const topCamp = namedCampaigns
        .slice()
        .sort((a, b) => Number(b.revenue) - Number(a.revenue))[0];
      if (topCamp && Number(topCamp.revenue) > 0) {
        insights.push(
          marketingInsight({
            id: "utm_top_campaign",
            kind: "opportunity",
            severity: "info",
            score: 40 + Math.min(20, Number(topCamp.pct_revenue)),
            title: "Top kampaň podľa tržieb",
            body: `${topCamp.label} tvorí ${fmtPct(Number(topCamp.pct_revenue))} tržieb v období.`,
            metric: { label: "Kampaň", value: topCamp.label },
            link: marketingLink(range, "campaign"),
          })
        );
      }

      const recent = Array.isArray(m.recentOrders) ? m.recentOrders : [];
      if (recent.length > 0) {
        const pending = recent.filter((o) => o.utm_attribution_ready === false).length;
        const pendingPct = (pending / recent.length) * 100;
        if (pendingPct >= INSIGHT_THRESHOLDS.utmAttributionPendingWarnPct) {
          insights.push(
            marketingInsight({
              id: "utm_attribution_pending",
              kind: "risk",
              severity: pendingPct >= 40 ? "warning" : "info",
              score: 50 + Math.min(30, pendingPct - INSIGHT_THRESHOLDS.utmAttributionPendingWarnPct),
              title: "Neúplná atribúcia",
              body: `U ${recent.length} top objednávkach má ${pending} (${fmtPct(pendingPct)}) ešte bez finálnej Shopify atribúcie (utm_attribution_ready=false).`,
              metric: { label: "Čaká na atribúciu", value: fmtPct(pendingPct) },
              link: marketingLink(range),
            })
          );
        }
      }

      const metaAds = m.bySource.find((r) =>
        labelMatchesChannel(r.label, /meta\s*ads|facebook/i)
      );
      if (metaAds && orders > 0) {
        const metaOrdPct = (Number(metaAds.orders) / orders) * 100;
        if (metaOrdPct >= INSIGHT_THRESHOLDS.utmMetaAdsOrdersWarnPct) {
          insights.push(
            marketingInsight({
              id: "utm_meta_ads_orders",
              kind: "risk",
              severity: metaOrdPct >= 35 ? "warning" : "info",
              score: 45 + Math.min(20, metaOrdPct - INSIGHT_THRESHOLDS.utmMetaAdsOrdersWarnPct),
              title: "Silný podiel Meta Ads",
              body: `Meta Ads tvorí ${fmtPct(metaOrdPct)} objednávok. Skontroluj kreatívy, UTM a landing page konzistenciu.`,
              metric: { label: "Meta Ads", value: fmtPct(metaOrdPct) },
              link: marketingLink(range, "source"),
            })
          );
        }
      }

      const direct = m.bySource.find((r) =>
        labelMatchesChannel(r.label, /^direct$/i)
      );
      if (direct && orders > 0) {
        const directOrdPct = (Number(direct.orders) / orders) * 100;
        if (directOrdPct >= 12) {
          insights.push(
            marketingInsight({
              id: "utm_direct_share",
              kind: "opportunity",
              severity: "info",
              score: 35 + Math.min(15, directOrdPct),
              title: "Významný Direct traffic",
              body: `Direct tvorí ${fmtPct(directOrdPct)} objednávok. Skontroluj, či ide o brand search alebo chýbajúci UTM na homepage.`,
              metric: { label: "Direct", value: fmtPct(directOrdPct) },
              link: marketingLink(range, "source"),
            })
          );
        }
      }

      const instagram = m.bySource.find((r) =>
        labelMatchesChannel(r.label, /instagram/i)
      );
      if (instagram && metaAds && orders > 0) {
        const igPct = (Number(instagram.orders) / orders) * 100;
        const metaPct = (Number(metaAds.orders) / orders) * 100;
        if (igPct >= 10 && metaPct >= 10) {
          insights.push(
            marketingInsight({
              id: "utm_instagram_meta_split",
              kind: "opportunity",
              severity: "info",
              score: 32,
              title: "Instagram + Meta Ads mix",
              body: `Instagram (${fmtPct(igPct)} a Meta Ads (${fmtPct(metaPct)}) sú oba významné platené kanály — sleduj ich spolu aj zvlášť.`,
              metric: { label: "Kanály", value: "IG + Meta" },
              link: marketingLink(range, "source"),
            })
          );
        }
      }
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
    .slice(0, 8);
  const opportunities = insights
    .filter((i) => i.kind === "opportunity")
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  return { risks, opportunities };
}

