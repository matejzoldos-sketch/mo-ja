import { isActiveSkladSku, skladSkuMeta } from "./skladSkuMeta";
import {
  SKLAD_CONFIRMED_AS_OF,
  SKLAD_CONFIRMED_STOCK,
  PENDING_ORIN_ORDER,
  confirmedTotal,
  pendingQtyForProduct,
  type ConfirmedProductStock,
} from "./skladConfirmed";

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
  /** Zdroj stavu: confirmed | xls */
  stock_source: "confirmed" | "xls";
  physical_as_of: string;
  physical_stock: number;
  eushipments?: number;
  lazaretska?: number;
  pending_inbound: number;
  stock_after_inbound: number;
  shopify_sku: string | null;
  shopify_available: number | null;
  sales_per_day_30d: number | null;
  units_sold_30d: number | null;
  /** Runway len zo súčasného fyzického stavu */
  days_runway: number | null;
  stockout_date: string | null;
  /** Runway po naskladnení pending Orin (ak je) */
  days_runway_after_inbound: number | null;
  stockout_date_after_inbound: string | null;
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

function runwayFromStock(
  stock: number,
  perDay: number | null
): { days: number | null; date: string | null } {
  if (stock <= 0) {
    return { days: 0, date: addDaysYmd(0) };
  }
  if (perDay == null || perDay <= 0) {
    return { days: null, date: null };
  }
  const days = Math.round(stock / perDay);
  return { days, date: addDaysYmd(days) };
}

type PhysInput =
  | { source: "confirmed"; row: ConfirmedProductStock }
  | { source: "xls"; row: PhysicalStockRow };

function buildPhysInputs(xlsRows: PhysicalStockRow[]): PhysInput[] {
  if (SKLAD_CONFIRMED_STOCK.length > 0) {
    return SKLAD_CONFIRMED_STOCK.map((row) => ({
      source: "confirmed" as const,
      row,
    }));
  }
  return xlsRows.map((row) => ({ source: "xls" as const, row }));
}

/**
 * Fyzický stav ÷ tempo predaja (Shopify 30 dní).
 * Preferuje potvrdený inventár (EuShipments + Lazaretská) pred XLS Sklad_sumár.
 */
export function computeRecommendedRunway(
  physicalRows: PhysicalStockRow[],
  shopifyRows: ShopifyInvRow[]
): RecommendedRunwayRow[] {
  const activeShopify = shopifyRows.filter((r) => isActiveSkladSku(r.sku));
  const inputs = buildPhysInputs(physicalRows);

  return inputs.map((input) => {
    const product_key =
      input.source === "confirmed"
        ? input.row.product_key
        : input.row.product_key;
    const product_label =
      input.source === "confirmed"
        ? input.row.product_label
        : input.row.product_label;

    const shopify = activeShopify.find(
      (r) => skladSkuMeta(r.sku)?.physicalProductKey === product_key
    );

    const perDay = shopify?.avg_daily_units_sold_30d ?? null;
    const units30 = shopify?.units_sold_30d ?? null;

    const physical_stock =
      input.source === "confirmed"
        ? confirmedTotal(input.row.locations)
        : input.row.stock_end;

    const pending_inbound = pendingQtyForProduct(product_key);
    const stock_after_inbound = physical_stock + pending_inbound;

    const now = runwayFromStock(physical_stock, perDay);
    const after = runwayFromStock(stock_after_inbound, perDay);

    return {
      product_key,
      product_label,
      stock_source: input.source,
      physical_as_of:
        input.source === "confirmed"
          ? SKLAD_CONFIRMED_AS_OF
          : input.row.month_key,
      physical_stock,
      eushipments:
        input.source === "confirmed"
          ? input.row.locations.eushipments
          : undefined,
      lazaretska:
        input.source === "confirmed"
          ? input.row.locations.lazaretska
          : undefined,
      pending_inbound,
      stock_after_inbound,
      shopify_sku: shopify?.sku ?? null,
      shopify_available: shopify?.available ?? null,
      sales_per_day_30d: perDay,
      units_sold_30d: units30,
      days_runway: now.days,
      stockout_date: now.date,
      days_runway_after_inbound: after.days,
      stockout_date_after_inbound: after.date,
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

export { PENDING_ORIN_ORDER, SKLAD_CONFIRMED_AS_OF, SKLAD_CONFIRMED_STOCK };
