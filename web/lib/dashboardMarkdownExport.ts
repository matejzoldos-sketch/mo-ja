type Kpis = {
  revenue: number;
  orders: number;
  aov: number;
  currency: string | null;
  avg_units_per_order?: number | null;
  avg_units_per_unique_customer?: number | null;
  avg_days_first_to_second_purchase?: number | null;
  returning_customers_pct?: number | null;
  avg_customer_ltv?: number | null;
};

type Daily = { date: string; revenue: number };
type TopProduct = { label: string; revenue: number; units: number };
type TopCustomer = {
  customer_id: number;
  orders: number;
  revenue: number;
  currency: string | null;
};
type RecentOrder = {
  id: number;
  name: string;
  created_at: string;
  financial_status: string | null;
  fulfillment_status: string | null;
  customer_display_name: string | null;
  total_price: number;
  currency: string | null;
};
type MonthlyNewVsReturning = {
  months: string[];
  newRevenue: number[];
  returningRevenue: number[];
};
type PurchaseCountBucket = {
  bucket: number;
  label: string;
  customers: number;
  pct: number;
};
type PurchaseIntervalBucket = {
  bucket: number;
  label: string;
  count: number;
};
type SkuDailyYtd = {
  from: string;
  to: string;
  skuOrder: string[];
  points: { date: string; sku: string; units: number }[];
};

export type DashboardMarkdownInput = {
  range: string;
  rangeLabel: string;
  kpiProductLabel: string;
  periodLabel: string;
  chartPeriodLabel: string;
  lastSyncAt?: string | null;
  lastSyncDisplay?: string;
  kpis: Kpis;
  dailyRevenue: Daily[];
  topProducts: TopProduct[];
  topCustomers?: TopCustomer[];
  recentOrders: RecentOrder[];
  monthlyNewVsReturning?: MonthlyNewVsReturning;
  purchaseCountDistribution?: PurchaseCountBucket[];
  purchaseIntervalHistogram?: { buckets: PurchaseIntervalBucket[] };
  skuDailyYtd?: SkuDailyYtd;
  trimLeadingZeroDailyRevenue?: boolean;
};

function mdCell(value: string | number): string {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function formatSkDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d}. ${m}. ${y}`;
}

function formatMonthSk(isoMonth: string): string {
  const [y, mo] = isoMonth.split("-").map(Number);
  if (!y || !mo) return isoMonth;
  const d = new Date(Date.UTC(y, mo - 1, 1));
  return d.toLocaleDateString("sk-SK", { month: "short", year: "numeric" });
}

function formatMoney(amount: number, currency: string | null): string {
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
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }
  return `${Number(value).toLocaleString("sk-SK", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} %`;
}

function formatUnits(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }
  return Number(value).toLocaleString("sk-SK", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });
}

function formatDays(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }
  return `${Number(value).toLocaleString("sk-SK", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} dní`;
}

function trimLeadingOnly<T>(rows: T[], isNonZero: (row: T) => boolean): T[] {
  if (rows.length === 0) return rows;
  let a = 0;
  while (a < rows.length && !isNonZero(rows[a])) a++;
  return rows.slice(a);
}

function trimLeadingZeroMonths(m: MonthlyNewVsReturning): MonthlyNewVsReturning {
  let i = 0;
  while (
    i < m.months.length &&
    Number(m.newRevenue[i] ?? 0) + Number(m.returningRevenue[i] ?? 0) === 0
  ) {
    i += 1;
  }
  return {
    months: m.months.slice(i),
    newRevenue: m.newRevenue.slice(i),
    returningRevenue: m.returningRevenue.slice(i),
  };
}

function mdTable(headers: string[], rows: (string | number)[][]): string {
  if (rows.length === 0) return "_Žiadne dáta._\n";
  const head = `| ${headers.map(mdCell).join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows
    .map((row) => `| ${row.map(mdCell).join(" | ")} |`)
    .join("\n");
  return `${head}\n${sep}\n${body}\n`;
}

export function buildDashboardMarkdown(input: DashboardMarkdownInput): string {
  const cur = input.kpis.currency;
  const lines: string[] = [];

  lines.push("# MO–JA Predajný dashboard");
  lines.push("");
  lines.push(`**Obdobie:** ${input.rangeLabel}${input.periodLabel ? ` (${input.periodLabel})` : ""}`);
  lines.push(`**Produkt:** ${input.kpiProductLabel}`);
  if (input.lastSyncDisplay) {
    lines.push(`**Posledný sync dát:** ${input.lastSyncDisplay}`);
  }
  lines.push("");
  lines.push(
    "_Dáta zobrazujú čisté predaje produktov zo zaplatených objednávok. Výpočty nezahŕňajú vstupenky na eventy, dopravu ani storná._"
  );
  lines.push("");

  lines.push("## KPI");
  lines.push("");
  const kpiRows: (string | number)[][] = [
    ["Obrat", formatMoney(Number(input.kpis.revenue), cur)],
    ["Počet objednávok", input.kpis.orders],
    ["AOV", formatMoney(Number(input.kpis.aov), cur)],
    ["Priem. kusov / objednávku", formatUnits(input.kpis.avg_units_per_order)],
    [
      "Priem. kusov na unikátneho zákazníka",
      formatUnits(input.kpis.avg_units_per_unique_customer),
    ],
  ];
  if (input.kpis.returning_customers_pct !== undefined) {
    kpiRows.push([
      "Opakovaní zákazníci (2+ obj.)",
      formatPct(input.kpis.returning_customers_pct),
    ]);
  }
  kpiRows.push([
    "Priem. dní medzi 1. a 2. nákupom",
    formatDays(input.kpis.avg_days_first_to_second_purchase),
  ]);
  kpiRows.push([
    "Priem. LTV / zákazníka",
    input.kpis.avg_customer_ltv === null ||
    input.kpis.avg_customer_ltv === undefined ||
    Number.isNaN(Number(input.kpis.avg_customer_ltv))
      ? "—"
      : formatMoney(Number(input.kpis.avg_customer_ltv), cur),
  ]);
  lines.push(mdTable(["Metrika", "Hodnota"], kpiRows));
  lines.push("");

  const daily =
    input.trimLeadingZeroDailyRevenue
      ? trimLeadingOnly(input.dailyRevenue, (d) => Number(d.revenue) !== 0)
      : input.dailyRevenue;
  if (daily.length > 0) {
    lines.push(`## Tržby po dňoch (${input.chartPeriodLabel})`);
    lines.push("");
    lines.push(
      mdTable(
        ["Dátum", "Tržby"],
        daily.map((d) => [formatSkDate(d.date), formatMoney(Number(d.revenue), cur)])
      )
    );
    lines.push("");
  }

  if (input.topProducts.length > 0) {
    lines.push(`## Tržby podľa produktu (${input.chartPeriodLabel})`);
    lines.push("");
    lines.push(
      mdTable(
        ["Produkt", "Tržby", "Kusy"],
        input.topProducts.map((p) => [
          p.label,
          formatMoney(Number(p.revenue), cur),
          p.units,
        ])
      )
    );
    lines.push("");
  }

  const monthly = input.monthlyNewVsReturning;
  if (
    monthly?.months?.length &&
    monthly.months.length === monthly.newRevenue.length &&
    monthly.months.length === monthly.returningRevenue.length
  ) {
    const trimmed = trimLeadingZeroMonths(monthly);
    if (trimmed.months.length > 0) {
      lines.push(
        `## Mesačné tržby: Noví vs. Vracajúci sa (${input.chartPeriodLabel})`
      );
      lines.push("");
      lines.push(
        mdTable(
          ["Mesiac", "Noví zákazníci", "Vracajúci sa"],
          trimmed.months.map((iso, i) => [
            formatMonthSk(iso),
            formatMoney(Number(trimmed.newRevenue[i] ?? 0), cur),
            formatMoney(Number(trimmed.returningRevenue[i] ?? 0), cur),
          ])
        )
      );
      lines.push("");
    }
  }

  const purchaseCount = input.purchaseCountDistribution;
  if (purchaseCount?.length) {
    lines.push(
      `## Zákazníci podľa počtu nákupov (${input.chartPeriodLabel})`
    );
    lines.push("");
    lines.push(
      mdTable(
        ["Počet nákupov", "Zákazníci", "Podiel"],
        purchaseCount.map((b) => [
          b.label,
          b.customers,
          formatPct(b.pct),
        ])
      )
    );
    lines.push("");
  }

  const intervalBuckets =
    input.purchaseIntervalHistogram?.buckets?.filter(
      (b) => b != null && typeof b.label === "string"
    ) ?? [];
  if (intervalBuckets.length > 0) {
    lines.push(
      `## Frekvencia nákupov — histogram intervalov (${input.chartPeriodLabel})`
    );
    lines.push("");
    lines.push(
      mdTable(
        ["Interval (dni)", "Počet párov nákupov"],
        intervalBuckets.map((b) => [b.label, b.count])
      )
    );
    lines.push("");
  }

  const topCustomers = input.topCustomers ?? [];
  if (topCustomers.length > 0) {
    lines.push(
      `## Top zákazníci podľa Shopify customer ID (${input.periodLabel})`
    );
    lines.push("");
    lines.push(
      mdTable(
        ["Customer ID", "Objednávky", "Tržby"],
        topCustomers.map((c) => [
          c.customer_id,
          c.orders,
          formatMoney(Number(c.revenue), c.currency || cur),
        ])
      )
    );
    lines.push("");
  }

  const sku = input.skuDailyYtd;
  if (sku?.skuOrder?.length && sku.points.length > 0) {
    const key = (d: string, s: string) => `${d}|${s}`;
    const m = new Map<string, number>();
    for (const p of sku.points) {
      m.set(key(p.date, p.sku), Number(p.units));
    }
    const skuPeriod =
      sku.from && sku.to
        ? `${formatSkDate(sku.from)} – ${formatSkDate(sku.to)}`
        : input.chartPeriodLabel;
    lines.push(`## Denné predané kusy podľa produktu (${skuPeriod})`);
    lines.push("");
    const skuRows: (string | number)[][] = [];
    for (const p of sku.points) {
      skuRows.push([formatSkDate(p.date), p.sku, p.units]);
    }
    skuRows.sort((a, b) =>
      String(a[0]).localeCompare(String(b[0]), "sk") ||
      String(a[1]).localeCompare(String(b[1]), "sk")
    );
    lines.push(mdTable(["Dátum", "Produkt", "Kusy"], skuRows));
    lines.push("");
  }

  if (input.recentOrders.length > 0) {
    lines.push(
      `## 10 objednávok s najvyššou sumou v období (${input.chartPeriodLabel})`
    );
    lines.push("");
    lines.push(
      mdTable(
        [
          "Objednávka",
          "Dátum",
          "Zákazník",
          "Platba",
          "Vybavenie",
          "Suma (prod.)",
        ],
        input.recentOrders.map((o) => [
          o.name,
          o.created_at,
          o.customer_display_name || "—",
          o.financial_status || "—",
          o.fulfillment_status || "—",
          formatMoney(Number(o.total_price), o.currency || cur),
        ])
      )
    );
    lines.push("");
  }

  lines.push("---");
  lines.push(
    `_Export: ${new Date().toLocaleString("sk-SK", { timeZone: "Europe/Bratislava" })} · filter ${input.range}${input.kpiProductLabel !== "Všetky produkty" ? ` · ${input.kpiProductLabel}` : ""}_`
  );

  return lines.join("\n");
}

export function downloadDashboardMarkdown(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
