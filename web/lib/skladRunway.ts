import { isActiveSkladSku, skladSkuMeta } from "./skladSkuMeta";

export type PhysicalStockRow = {
  month_key: string;
  product_key: string;
  product_label: string;
  stock_end: number;
};

export type ShopifyInvRow = {
  sku: string;
  product_title?: string;
  available: number;
  avg_daily_units_sold_30d?: number | null;
  units_sold_30d?: number | null;
};

export type RecommendedRunwayRow = {
  product_key: string;
  product_label: string;
  physical_month_key: string;
  physical_stock: number;
  shopify_sku: string | null;
  shopify_available: number | null;
  sales_per_day_30d: number | null;
  units_sold_30d: number | null;
  days_runway: number | null;
  stockout_date: string | null;
};

function addDaysYmd(days: number): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bratislava",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value) - 1;
  const d = Number(parts.find((p) => p.type === "day")?.value);
  const dt = new Date(y, m, d + Math.round(days));
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Fyzický stav (XLS) ÷ tempo predaja (Shopify, 30 dní) — najpresnejší odhad runway. */
export function computeRecommendedRunway(
  physicalRows: PhysicalStockRow[],
  shopifyRows: ShopifyInvRow[]
): RecommendedRunwayRow[] {
  const activeShopify = shopifyRows.filter((r) => isActiveSkladSku(r.sku));

  return physicalRows.map((phys) => {
    const shopify = activeShopify.find(
      (r) => skladSkuMeta(r.sku)?.physicalProductKey === phys.product_key
    );

    const perDay = shopify?.avg_daily_units_sold_30d ?? null;
    const units30 = shopify?.units_sold_30d ?? null;
    const stock = phys.stock_end;

    let days_runway: number | null = null;
    let stockout_date: string | null = null;

    if (stock <= 0) {
      days_runway = 0;
      stockout_date = addDaysYmd(0);
    } else if (perDay != null && perDay > 0) {
      days_runway = Math.round(stock / perDay);
      stockout_date = addDaysYmd(days_runway);
    }

    return {
      product_key: phys.product_key,
      product_label: phys.product_label,
      physical_month_key: phys.month_key,
      physical_stock: stock,
      shopify_sku: shopify?.sku ?? null,
      shopify_available: shopify?.available ?? null,
      sales_per_day_30d: perDay,
      units_sold_30d: units30,
      days_runway,
      stockout_date,
    };
  });
}

export function formatRunwayDays(days: number | null): string {
  if (days == null) return "—";
  if (days <= 0) return "vypredané";
  if (days === 1) return "1 deň";
  if (days < 5) return `${days} dni`;
  const weeks = Math.round(days / 7);
  if (days < 45) return `${days} dní (~${weeks} týž.)`;
  const months = Math.round(days / 30);
  return `${days} dní (~${months} mes.)`;
}
