import type { DashboardRangeKey } from "@/lib/dashboardPeriodFilter";

export type MarketingRangeKey = DashboardRangeKey;

export type MarketingDimensionKey = "source" | "medium" | "campaign" | "agency";

export type MarketingBreakdownRow = {
  label: string;
  orders: number;
  revenue: number;
  pct_orders: number;
  pct_revenue: number;
  spend_eur?: number | null;
  roas?: number | null;
};

export type MarketingRecentOrder = {
  id: number;
  name: string;
  created_at: string;
  revenue: number;
  currency: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  channel_source: string;
  utm_landing_page: string | null;
  utm_attribution_ready: boolean | null;
};

export type MarketingPayloadForExport = {
  meta: { range: string; from: string; to: string };
  kpis: {
    orders: number;
    orders_with_utm: number;
    orders_without_utm: number;
    revenue: number;
    currency: string;
    pct_orders_with_utm: number | null;
  };
  bySource: MarketingBreakdownRow[];
  byMedium: MarketingBreakdownRow[];
  byCampaign: MarketingBreakdownRow[];
  recentOrders: MarketingRecentOrder[];
};

export type AgencyLifetimeRow = {
  label: string;
  active_from: string;
  active_to: string;
  days_active: number;
  orders: number;
  revenue: number;
  spend_eur: number;
  roas: number | null;
};

export type AgencyFirstDaysRow = {
  first_days: number;
  label: string;
  window_from: string;
  window_to: string;
  orders: number;
  revenue: number;
  spend_eur: number;
  roas: number | null;
};

export type AgencyFromFirstSalesRow = {
  label: string;
  first_sales_campaign: string;
  active_from: string;
  active_to: string;
  days_active: number;
  orders: number;
  revenue: number;
  spend_eur: number;
  roas: number | null;
};

export type AgencyBenchmark = {
  lifetime: AgencyLifetimeRow[];
  firstDays: AgencyFirstDaysRow[];
  fromFirstSales: AgencyFromFirstSalesRow[];
};

export type MarketingMarkdownInput = {
  range: MarketingRangeKey;
  rangeLabel: string;
  periodLabel: string;
  dimension: MarketingDimensionKey;
  dimensionLabel: string;
  from: string;
  to: string;
  kpis: MarketingPayloadForExport["kpis"];
  breakdownRows: MarketingBreakdownRow[];
  agencyBenchmark?: AgencyBenchmark;
  currency: string;
};

function mdCell(value: string | number | null | undefined): string {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function formatMoney(amount: number, currency: string | null | undefined): string {
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

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toLocaleString("sk-SK", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} %`;
}

function mdTable(headers: string[], rows: (string | number)[][]): string {
  if (rows.length === 0) return "_Žiadne dáta._\n";
  const head = `| ${headers.map(mdCell).join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.map(mdCell).join(" | ")} |`).join("\n");
  return `${head}\n${sep}\n${body}\n`;
}

export function buildMarketingMarkdown(input: MarketingMarkdownInput): string {
  const lines: string[] = [];
  lines.push("# MO–JA Marketing dashboard");
  lines.push("");
  lines.push(`**Obdobie:** ${input.rangeLabel}${input.periodLabel ? ` (${input.periodLabel})` : ""}`);
  lines.push(`**Rozmer:** ${input.dimensionLabel}`);
  lines.push("");
  lines.push(
    "_Dáta vychádzajú z produktových (paid-ish) objednávok. UTM atribúcia je podľa Shopify customerJourneySummary (last-touch)._"
  );
  lines.push("");

  lines.push("## KPI");
  lines.push("");
  const kpiRows: (string | number)[][] = [
    ["Objednávky (produktové)", input.kpis.orders],
    ["Tržby (produktové riadky)", formatMoney(Number(input.kpis.revenue), input.currency)],
    ["Objednávky s UTM", input.kpis.orders_with_utm],
    ["Podiel objednávok s UTM", formatPct(input.kpis.pct_orders_with_utm)],
    ["Objednávky bez UTM", input.kpis.orders_without_utm],
  ];
  lines.push(mdTable(["Metrika", "Hodnota"], kpiRows));
  lines.push("");

  if (input.breakdownRows.length > 0) {
    lines.push(`## Podiel tržieb podľa ${input.dimensionLabel}`);
    lines.push("");
    if (input.dimension === "agency") {
      lines.push(
        mdTable(
          ["Kanál", "Obj.", "Tržby", "Spend", "ROAS", "% obj.", "% tržby"],
          input.breakdownRows.map((r) => [
            r.label,
            r.orders,
            formatMoney(Number(r.revenue), input.currency),
            r.spend_eur != null ? formatMoney(Number(r.spend_eur), input.currency) : "—",
            r.roas != null ? `${Number(r.roas).toFixed(2)}×` : "—",
            formatPct(r.pct_orders),
            formatPct(r.pct_revenue),
          ])
        )
      );
    } else {
      lines.push(
        mdTable(
          ["Kanál", "Obj.", "Tržby", "% obj.", "% tržby"],
          input.breakdownRows.map((r) => [
            r.label,
            r.orders,
            formatMoney(Number(r.revenue), input.currency),
            formatPct(r.pct_orders),
            formatPct(r.pct_revenue),
          ])
        )
      );
    }
    lines.push("");
  }

  if (input.dimension === "agency" && input.agencyBenchmark) {
    const { lifetime, firstDays, fromFirstSales } = input.agencyBenchmark;
    if (fromFirstSales.length > 0) {
      lines.push("## Férové porovnanie — od prvej sales kampane");
      lines.push("");
      lines.push(
        mdTable(
          [
            "Agentúra",
            "Prvá sales kampaň",
            "Od",
            "Do",
            "Dní",
            "Obj.",
            "Tržby",
            "Spend",
            "ROAS",
          ],
          fromFirstSales.map((r) => [
            r.label,
            r.first_sales_campaign,
            r.active_from,
            r.active_to,
            r.days_active,
            r.orders,
            formatMoney(Number(r.revenue), input.currency),
            formatMoney(Number(r.spend_eur), input.currency),
            r.roas != null ? `${Number(r.roas).toFixed(2)}×` : "—",
          ])
        )
      );
      lines.push("");
    }
    if (lifetime.length > 0) {
      lines.push("## Férové porovnanie — celé aktívne obdobie");
      lines.push("");
      lines.push(
        mdTable(
          ["Agentúra", "Od", "Do", "Dní", "Obj.", "Tržby", "Spend", "ROAS"],
          lifetime.map((r) => [
            r.label,
            r.active_from,
            r.active_to,
            r.days_active,
            r.orders,
            formatMoney(Number(r.revenue), input.currency),
            formatMoney(Number(r.spend_eur), input.currency),
            r.roas != null ? `${Number(r.roas).toFixed(2)}×` : "—",
          ])
        )
      );
      lines.push("");
    }
    if (firstDays.length > 0) {
      lines.push("## Férové porovnanie — prvých N dní od štartu");
      lines.push("");
      const daysSet = Array.from(
        new Set(firstDays.map((r) => r.first_days))
      ).sort((a, b) => a - b);
      for (const days of daysSet) {
        const rows = firstDays.filter((r) => r.first_days === days);
        lines.push(`### Prvých ${days} dní`);
        lines.push("");
        lines.push(
          mdTable(
            ["Agentúra", "Od", "Do", "Obj.", "Tržby", "Spend", "ROAS"],
            rows.map((r) => [
              r.label,
              r.window_from,
              r.window_to,
              r.orders,
              formatMoney(Number(r.revenue), input.currency),
              formatMoney(Number(r.spend_eur), input.currency),
              r.roas != null ? `${Number(r.roas).toFixed(2)}×` : "—",
            ])
          )
        );
        lines.push("");
      }
    }
  }

  lines.push("---");
  lines.push(`_Export: ${new Date().toLocaleString("sk-SK")} · filter ${input.range} · ${input.dimensionLabel}_`);
  return lines.join("\n");
}

export function downloadMarketingMarkdown(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export type MerMarkdownInput = {
  rangeLabel: string;
  from: string;
  to: string;
  launchFrom?: string | null;
  currency: string;
  kpis: {
    revenue: number;
    orders?: number;
    aov?: number | null;
    ads_spend: number;
    fees_spend: number;
    agency_fees_spend?: number;
    total_mkt_spend: number;
    mer: number | null;
    ad_roas: number | null;
    m_roas?: number | null;
  };
  monthly: {
    month: string;
    revenue: number;
    orders?: number;
    aov?: number | null;
    ads_spend: number;
    fees_spend: number;
    agency_fees_spend?: number;
    total_mkt_spend: number;
    mer: number | null;
    ad_roas: number | null;
    m_roas?: number | null;
    mom_revenue_pct?: number | null;
    yoy_revenue_pct: number | null;
  }[];
  feesBreakdown: { month?: string; label: string; amount_eur: number }[];
  unmappedExpenses: {
    label: string;
    line_text: string;
    debit_account: string;
    amount_eur: number;
  }[];
};

function formatRatioMd(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${Number(n).toFixed(2)}×`;
}

export function buildMarketingMerMarkdown(input: MerMarkdownInput): string {
  const lines: string[] = [];
  lines.push("# MO–JA Marketing MER");
  lines.push("");
  lines.push(`**Obdobie:** ${input.rangeLabel} (${input.from} – ${input.to})`);
  if (input.launchFrom) {
    lines.push(`**Mesačný vývoj od:** ${input.launchFrom}`);
  }
  lines.push("");
  lines.push(
    "_Ads = Meta CSV · Fees = účtovný denník (518/5015) · Meta FP v denníku sa nepočíta dvakrát._"
  );
  lines.push("");

  lines.push("## KPI");
  lines.push("");
  lines.push(
    mdTable(
      ["Metrika", "Hodnota"],
      [
        ["Revenue", formatMoney(input.kpis.revenue, input.currency)],
        ["Orders", input.kpis.orders ?? "—"],
        [
          "AOV",
          input.kpis.aov == null
            ? "—"
            : formatMoney(input.kpis.aov, input.currency),
        ],
        ["Ads spend", formatMoney(input.kpis.ads_spend, input.currency)],
        ["Fees", formatMoney(input.kpis.fees_spend, input.currency)],
        [
          "Fees agentúra",
          formatMoney(input.kpis.agency_fees_spend ?? 0, input.currency),
        ],
        ["Total MKT", formatMoney(input.kpis.total_mkt_spend, input.currency)],
        ["MER", formatRatioMd(input.kpis.mer)],
        ["Ad ROAS", formatRatioMd(input.kpis.ad_roas)],
        ["mROAS", formatRatioMd(input.kpis.m_roas ?? null)],
      ]
    )
  );
  lines.push("");

  if (input.monthly.length > 0) {
    lines.push("## Mesačná tabuľka");
    lines.push("");
    lines.push(
      mdTable(
        ["Mesiac", "Revenue", "Orders", "AOV", "Ads", "Fees", "Fees agentúra", "Total MKT", "MER", "Ad ROAS", "mROAS", "MoM Rev", "YoY Rev"],
        input.monthly.map((r) => [
          r.month,
          formatMoney(r.revenue, input.currency),
          r.orders ?? "—",
          r.aov == null ? "—" : formatMoney(r.aov, input.currency),
          formatMoney(r.ads_spend, input.currency),
          formatMoney(r.fees_spend, input.currency),
          formatMoney(r.agency_fees_spend ?? 0, input.currency),
          formatMoney(r.total_mkt_spend, input.currency),
          formatRatioMd(r.mer),
          formatRatioMd(r.ad_roas),
          formatRatioMd(r.m_roas ?? null),
          r.mom_revenue_pct == null
            ? "—"
            : `${r.mom_revenue_pct > 0 ? "+" : ""}${r.mom_revenue_pct} %`,
          r.yoy_revenue_pct == null
            ? "—"
            : `${r.yoy_revenue_pct > 0 ? "+" : ""}${r.yoy_revenue_pct} %`,
        ])
      )
    );
    lines.push("");
  }

  if (input.feesBreakdown.length > 0) {
    lines.push("## Fees breakdown (denník) · po mesiacoch");
    lines.push("");
    const hasMonth = input.feesBreakdown.some(
      (r) => typeof r.month === "string" && /^\d{4}-\d{2}$/.test(r.month)
    );
    if (hasMonth) {
      lines.push(
        mdTable(
          ["Mesiac", "Dodávateľ", "Suma"],
          input.feesBreakdown.map((r) => [
            r.month ?? "—",
            r.label,
            formatMoney(r.amount_eur, input.currency),
          ])
        )
      );
    } else {
      lines.push(
        mdTable(
          ["Dodávateľ", "Suma"],
          input.feesBreakdown.map((r) => [
            r.label,
            formatMoney(r.amount_eur, input.currency),
          ])
        )
      );
    }
    lines.push("");
  }

  if (input.unmappedExpenses.length > 0) {
    lines.push("## Nemapované náklady (na overenie)");
    lines.push("");
    lines.push(
      mdTable(
        ["Dodávateľ", "Text", "Účet", "Suma"],
        input.unmappedExpenses.map((r) => [
          r.label,
          r.line_text,
          r.debit_account,
          formatMoney(r.amount_eur, input.currency),
        ])
      )
    );
    lines.push("");
  }

  lines.push("---");
  lines.push(`_Export: ${new Date().toLocaleString("sk-SK")} · MER_`);
  return lines.join("\n");
}

