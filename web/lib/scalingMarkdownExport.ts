/** Markdown export for Spend (executive scaling) dashboard. */

export type ScalingExportCard = {
  title: string;
  metric_label: string;
  metric_value: number | null;
  metric_unit: string;
  target: number;
  target_op: string;
  status: string;
  detail?: Record<string, number | boolean | string | null | undefined>;
};

export type ScalingExportMonth = {
  month: string;
  net_sales: number;
  orders: number;
  aov: number | null;
  meta_spend: number;
  agency_fee: number;
  total_spend: number;
  blended_pno_pct: number | null;
  sessions: number;
  store_cr_pct: number | null;
  utm_meta_net_sales: number;
  utm_real_roas: number | null;
  meta_reported_roas?: number | null;
  meta_click_sales?: number;
  meta_view_sales?: number;
};

export type ScalingMarkdownInput = {
  windowFrom: string;
  windowTo: string;
  windowDays: number;
  ytdFrom: string;
  asOf: string;
  verdictLabel: string;
  failReasons: string[];
  cards: ScalingExportCard[];
  monthly: ScalingExportMonth[];
  attribution?: {
    meta_click_sales: number;
    meta_view_sales: number;
    shopify_utm_net_sales: number;
    view_through_ratio_pct: number | null;
    attribution_split_is_proxy: boolean;
    warn_message: string | null;
  } | null;
};

function money(n: number): string {
  return new Intl.NumberFormat("sk-SK", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

function metric(v: number | null, unit: string): string {
  if (v == null) return "—";
  if (unit === "%") return `${v.toFixed(2)} %`;
  if (unit === "×") return `${v.toFixed(2)}×`;
  return String(v);
}

export function buildScalingMarkdown(input: ScalingMarkdownInput): string {
  const lines: string[] = [];
  lines.push("# MO–JA · Spend rozhodnutie");
  lines.push("");
  lines.push(
    `Okno: posledných ${input.windowDays} dní (${input.windowFrom} → ${input.windowTo})`
  );
  lines.push(`YTD od: ${input.ytdFrom}`);
  lines.push(`As of: ${input.asOf}`);
  lines.push("");
  lines.push(`## Verdikt`);
  lines.push("");
  lines.push(`**${input.verdictLabel}**`);
  if (input.failReasons.length) {
    lines.push("");
    for (const r of input.failReasons) lines.push(`- ${r}`);
  }
  lines.push("");
  lines.push("## Decision matrix (14 dní)");
  lines.push("");
  for (const c of input.cards) {
    lines.push(
      `### ${c.title} — ${c.status.toUpperCase()}`
    );
    lines.push(
      `- ${c.metric_label}: ${metric(c.metric_value, c.metric_unit)} (target ${c.target_op} ${c.target}${c.metric_unit === "×" ? "×" : c.metric_unit === "%" ? " %" : ""})`
    );
    if (c.detail) {
      for (const [k, v] of Object.entries(c.detail)) {
        if (v == null || typeof v === "boolean") continue;
        const isMoney =
          /sales|spend|fee|value/i.test(k) && typeof v === "number";
        lines.push(`- ${k}: ${isMoney ? money(Number(v)) : String(v)}`);
      }
    }
    lines.push("");
  }

  if (input.attribution) {
    const a = input.attribution;
    lines.push("## Meta vs Shopify UTM (YTD)");
    lines.push("");
    lines.push(
      a.attribution_split_is_proxy
        ? `- Meta nadhodnotenie vs UTM: ${a.view_through_ratio_pct ?? "—"} %`
        : `- Meta View-Through Ratio: ${a.view_through_ratio_pct ?? "—"} %`
    );
    lines.push(`- Meta click sales: ${money(a.meta_click_sales)}`);
    lines.push(`- Meta view sales: ${money(a.meta_view_sales)}`);
    lines.push(`- Shopify UTM net sales: ${money(a.shopify_utm_net_sales)}`);
    if (a.warn_message) lines.push(`- ${a.warn_message}`);
    lines.push("");
  }

  lines.push("## YTD mesačne");
  lines.push("");
  lines.push(
    "| Mesiac | Net sales | Orders | Meta spend | Agency | PNO % | Store CR % | UTM ROAS | Meta ROAS |"
  );
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const m of input.monthly) {
    lines.push(
      `| ${m.month} | ${money(m.net_sales)} | ${m.orders} | ${money(m.meta_spend)} | ${money(m.agency_fee)} | ${m.blended_pno_pct ?? "—"} | ${m.store_cr_pct ?? "—"} | ${m.utm_real_roas ?? "—"} | ${m.meta_reported_roas ?? "—"} |`
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function downloadScalingMarkdown(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
