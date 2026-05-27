export type MarketingRangeKey = "30d" | "90d" | "365d";

export type MarketingDimensionKey = "source" | "medium" | "campaign";

export type MarketingBreakdownRow = {
  label: string;
  orders: number;
  revenue: number;
  pct_orders: number;
  pct_revenue: number;
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
  recentOrders: MarketingRecentOrder[];
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
    lines.push("");
  }

  if (input.recentOrders.length > 0) {
    lines.push("## Top objednávky s UTM (max 50)");
    lines.push("");
    lines.push(
      mdTable(
        ["Objednávka", "Dátum", "Tržby", "Zdroj", "Medium", "Kampaň", "UTM ready"],
        input.recentOrders.slice(0, 50).map((o) => [
          o.name,
          o.created_at,
          formatMoney(Number(o.revenue), o.currency || input.currency),
          o.utm_source ?? "—",
          o.utm_medium ?? "—",
          o.utm_campaign ?? "—",
          o.utm_attribution_ready == null ? "—" : o.utm_attribution_ready ? "yes" : "no",
        ])
      )
    );
    lines.push("");
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

