/** Hybrid P&L: XLS revenue + OPEX, COGS = rate × net goods revenue (Orin). */

export const COGS_RATE = 0.42;

export type PnlXlsMonth = {
  month_key: string;
  revenue: number;
  /** Čisté tržby za tovar (produkty − zľavy, bez dopravy). */
  revenue_goods?: number;
  costs: number;
  profit_month: number;
  profit_ytd: number;
  marketing: number;
  opex: number;
  other_operating: number;
  staff: number;
  margin_pct: number | null;
};

export type PnlXlsPayload = {
  meta: {
    year: number | string;
    from: string;
    to: string;
    last_actual_month: number;
    last_month_key?: string;
    note: string;
  };
  totals: {
    revenue_ytd: number;
    costs_ytd: number;
    profit_ytd: number;
    marketing_ytd: number;
    opex_ytd: number;
    other_operating_ytd: number;
    staff_ytd: number;
  };
  monthly: PnlXlsMonth[];
  topExpenses?: PnlTopExpense[];
  topExpensesLastMonth?: PnlTopExpense[];
};

export type PnlTopExpense = {
  supplier: string;
  account_prefix: string;
  amount_eur: number;
  line_count: number;
  is_marketing: boolean;
  is_staff: boolean;
};

export type PnlHybridMonth = {
  month_key: string;
  sales_goods: number;
  sales_services: number;
  other_revenue: number;
  total_revenue: number;
  cogs_journal: number;
  cogs_estimated: number;
  cogs: number;
  gross_profit: number;
  material: number;
  representation: number;
  services: number;
  taxes_fees: number;
  other_operating: number;
  financial: number;
  total_opex: number;
  marketing_spend: number;
  staff_spend: number;
  contribution_margin: number;
};

export type PnlHybridPayload = {
  meta: {
    year: string;
    from: string;
    to: string;
    note: string;
    last_actual_month?: number;
    last_month_key?: string;
  };
  totals: {
    total_revenue: number;
    cogs_journal: number;
    cogs_estimated: number;
    cogs: number;
    gross_profit: number;
    total_opex: number;
    contribution_margin: number;
    marketing_spend: number;
    staff_spend: number;
  };
  monthly: PnlHybridMonth[];
  topExpenses: PnlTopExpense[];
  topExpensesLastMonth: PnlTopExpense[];
};

function monthShortLabel(ym: string): string {
  const [, m] = ym.split("-");
  const labels = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "Máj",
    "Jún",
    "Júl",
    "Aug",
    "Sep",
    "Okt",
    "Nov",
    "Dec",
  ];
  return labels[parseInt(m, 10) - 1] ?? m;
}

export function goodsRevenue(m: PnlXlsMonth): number {
  const g = Number(m.revenue_goods);
  if (Number.isFinite(g) && g > 0) return g;
  return m.revenue;
}

export function transformHybridPayload(xls: PnlXlsPayload): PnlHybridPayload {
  const lastActual = xls.meta.last_actual_month ?? 12;

  const actualMonths = xls.monthly.filter((m) => {
    const monthNum = parseInt(m.month_key.split("-")[1], 10);
    return monthNum <= lastActual;
  });

  const mapped: PnlHybridMonth[] = actualMonths.map((m) => {
    const goods = goodsRevenue(m);
    const cogs = Math.round(goods * COGS_RATE * 100) / 100;
    const grossProfit = m.revenue - cogs;
    const opex = m.opex;
    const cm = grossProfit - opex;
    const services = Math.max(0, m.revenue - goods);
    return {
      month_key: m.month_key,
      sales_goods: goods,
      sales_services: services,
      other_revenue: 0,
      total_revenue: m.revenue,
      cogs_journal: 0,
      cogs_estimated: cogs,
      cogs,
      gross_profit: grossProfit,
      material: 0,
      representation: 0,
      services: Math.max(0, m.opex - m.other_operating),
      taxes_fees: 0,
      other_operating: m.other_operating,
      financial: 0,
      total_opex: opex,
      marketing_spend: m.marketing,
      staff_spend: m.staff ?? 0,
      contribution_margin: cm,
    };
  });

  const sumRev = mapped.reduce((s, m) => s + m.total_revenue, 0);
  const sumCogs = mapped.reduce((s, m) => s + m.cogs, 0);
  const sumOpex = mapped.reduce((s, m) => s + m.total_opex, 0);
  const sumCm = mapped.reduce((s, m) => s + m.contribution_margin, 0);
  const sumMk = mapped.reduce((s, m) => s + m.marketing_spend, 0);
  const sumStaff = mapped.reduce((s, m) => s + m.staff_spend, 0);
  const lastKey =
    xls.meta.last_month_key ??
    actualMonths[actualMonths.length - 1]?.month_key ??
    "01";

  return {
    meta: {
      year: String(xls.meta.year),
      from: xls.meta.from,
      to: xls.meta.to,
      note: `Hybrid: tržby a OPEX z XLS, COGS = ${(COGS_RATE * 100).toFixed(0)} % čistých tržieb za tovar (nákup Orin). Jan–${monthShortLabel(lastKey)} ${xls.meta.year}.`,
      last_actual_month: lastActual,
      last_month_key: lastKey,
    },
    totals: {
      total_revenue: sumRev,
      cogs_journal: 0,
      cogs_estimated: sumCogs,
      cogs: sumCogs,
      gross_profit: sumRev - sumCogs,
      total_opex: sumOpex,
      contribution_margin: sumCm,
      marketing_spend: sumMk,
      staff_spend: sumStaff,
    },
    monthly: mapped,
    topExpenses: xls.topExpenses ?? [],
    topExpensesLastMonth: xls.topExpensesLastMonth ?? [],
  };
}
