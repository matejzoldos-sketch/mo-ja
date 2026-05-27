export type InsightKind = "risk" | "opportunity";
export type InsightSeverity = "critical" | "warning" | "info";

export type Insight = {
  id: string;
  kind: InsightKind;
  severity: InsightSeverity;
  score: number;
  title: string;
  body: string;
  metric?: { label: string; value: string; delta?: string };
  link?: { href: string; label: string };
};

export type DashboardKpis = {
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

export type Daily = { date: string; revenue: number };
export type TopProduct = { label: string; revenue: number; units: number };

export type PurchaseCountBucket = {
  bucket: number;
  label: string;
  customers: number;
  pct: number;
};

export type SkuDaily = {
  year: number;
  range?: string;
  from: string;
  to: string;
  kpi_product?: string;
  skuOrder: string[];
  points: { date: string; sku: string; units: number }[];
};

export type DashboardPayload = {
  meta: { range: string; from: string; to: string; kpi_product?: string };
  kpis: DashboardKpis;
  dailyRevenue: Daily[];
  topProducts: TopProduct[];
  purchaseCountDistribution?: PurchaseCountBucket[];
};

export type InsightsResponse = {
  meta: { range: string; from: string; to: string; kpi_product?: string };
  generatedAt: string;
  risks: Insight[];
  opportunities: Insight[];
};

export type InventoryRow = {
  inventory_item_id: number;
  location_id: number;
  location_name: string | null;
  sku: string;
  product_title?: string;
  available: number;
  updated_at: string | null;
  fetched_at: string | null;
  avg_daily_units_sold_ytd: number | null;
  estimated_stockout_date?: string | null;
  estimated_days_of_stock?: number | null;
};


