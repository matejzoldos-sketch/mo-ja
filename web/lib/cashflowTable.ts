import {
  displayCounterparty,
  type CashflowEnrichedTx,
} from "./cashflowPie";

export type CashflowCategoryKey =
  | "revenue"
  | "payroll"
  | "tax"
  | "insurance"
  | "rent"
  | "marketing"
  | "bank_fee"
  | "card_expense"
  | "supplier"
  | "other";

export const CASHFLOW_CATEGORY_LABELS: Record<CashflowCategoryKey, string> = {
  revenue: "Tržby",
  payroll: "Mzdy / fakturanti",
  tax: "Dane",
  insurance: "Poisťovne / odvody",
  rent: "Nájom",
  marketing: "Marketing",
  bank_fee: "Bankové poplatky",
  card_expense: "Platba bez protistrany",
  supplier: "Dodávatelia",
  other: "Ostatné",
};

export type CashflowTableRow = {
  booking_date: string;
  monthKey: string;
  direction: "credit" | "debit";
  directionLabel: string;
  category: CashflowCategoryKey;
  categoryLabel: string;
  counterparty: string;
  amount: number;
  remittance: string;
};

export type CashflowTableFilters = {
  month: string;
  date: string;
  direction: "" | "credit" | "debit";
  category: string;
  counterparty: string;
  amount: string;
  remittance: string;
};

export const EMPTY_CASHFLOW_TABLE_FILTERS: CashflowTableFilters = {
  month: "",
  date: "",
  direction: "",
  category: "",
  counterparty: "",
  amount: "",
  remittance: "",
};

const COMPANY_MARKERS =
  /\b(s\.?\s*r\.?\s*o\.?|a\.?\s*s\.?|spol\.?|k\.?\s*s\.?|v\.?\s*o\.?\s*s\.?|gmbh|inc\.?|ltd\.?)\b/i;

function haystack(tx: CashflowEnrichedTx, counterparty: string): string {
  return [
    counterparty,
    tx.creditor_name,
    tx.debtor_name,
    tx.trading_party,
    tx.remittance_info,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function inferCashflowCategory(
  tx: CashflowEnrichedTx,
  counterparty: string
): { key: CashflowCategoryKey; label: string } {
  const h = haystack(tx, counterparty);
  const isCredit = tx.amount > 0;

  if (isCredit) {
    if (h.includes("stripe") || h.includes("shopify")) {
      return { key: "revenue", label: CASHFLOW_CATEGORY_LABELS.revenue };
    }
    return { key: "revenue", label: CASHFLOW_CATEGORY_LABELS.revenue };
  }

  if (
    counterparty === "Neuvedené" ||
    (!tx.creditor_name?.trim() && !tx.creditor_iban?.trim())
  ) {
    if (h.includes("premium api") || h.includes("poplatok")) {
      return { key: "bank_fee", label: CASHFLOW_CATEGORY_LABELS.bank_fee };
    }
    return {
      key: "card_expense",
      label: CASHFLOW_CATEGORY_LABELS.card_expense,
    };
  }

  if (h.includes("skutil")) {
    return { key: "payroll", label: CASHFLOW_CATEGORY_LABELS.payroll };
  }
  if (h.includes("najom")) {
    return { key: "rent", label: CASHFLOW_CATEGORY_LABELS.rent };
  }
  if (
    h.includes("danetax") ||
    h.includes(" dph") ||
    h.includes("vs:") ||
    h.includes("financne riaditelstvo")
  ) {
    return { key: "tax", label: CASHFLOW_CATEGORY_LABELS.tax };
  }
  if (h.includes("poist") || h.includes("dovera") || h.includes("vszp")) {
    return { key: "insurance", label: CASHFLOW_CATEGORY_LABELS.insurance };
  }
  if (h.includes("premium api") || h.includes("poplatok za sluzbu")) {
    return { key: "bank_fee", label: CASHFLOW_CATEGORY_LABELS.bank_fee };
  }
  if (
    h.includes("marketing") ||
    h.includes("facebook") ||
    h.includes("google ads")
  ) {
    return { key: "marketing", label: CASHFLOW_CATEGORY_LABELS.marketing };
  }
  if (COMPANY_MARKERS.test(counterparty)) {
    return { key: "supplier", label: CASHFLOW_CATEGORY_LABELS.supplier };
  }

  return { key: "other", label: CASHFLOW_CATEGORY_LABELS.other };
}

export function buildCashflowTableRows(
  txns: CashflowEnrichedTx[]
): CashflowTableRow[] {
  return txns
    .map((tx) => {
      const counterparty = displayCounterparty(tx);
      const { key, label } = inferCashflowCategory(tx, counterparty);
      const direction: "credit" | "debit" = tx.amount >= 0 ? "credit" : "debit";
      return {
        booking_date: tx.booking_date,
        monthKey: tx.booking_date.slice(0, 7),
        direction,
        directionLabel: direction === "credit" ? "Kredit" : "Debet",
        category: key,
        categoryLabel: label,
        counterparty,
        amount: tx.amount,
        remittance: tx.remittance_info?.trim() || "",
      };
    })
    .sort((a, b) => {
      const d = b.booking_date.localeCompare(a.booking_date);
      if (d !== 0) return d;
      return Math.abs(b.amount) - Math.abs(a.amount);
    });
}

function matchesText(value: string, filter: string): boolean {
  const q = filter.trim().toLowerCase();
  if (!q) return true;
  return value.toLowerCase().includes(q);
}

export function filterCashflowTableRows(
  rows: CashflowTableRow[],
  filters: CashflowTableFilters
): CashflowTableRow[] {
  return rows.filter((row) => {
    if (filters.month && row.monthKey !== filters.month) return false;
    if (filters.direction && row.direction !== filters.direction) return false;
    if (!matchesText(row.booking_date, filters.date)) return false;
    if (
      !matchesText(row.categoryLabel, filters.category) &&
      !matchesText(row.category, filters.category)
    ) {
      return false;
    }
    if (!matchesText(row.counterparty, filters.counterparty)) return false;
    if (
      !matchesText(String(row.amount), filters.amount) &&
      !matchesText(String(Math.abs(row.amount)), filters.amount)
    ) {
      return false;
    }
    if (!matchesText(row.remittance, filters.remittance)) return false;
    return true;
  });
}

export function formatCashflowDate(iso: string): string {
  const ymd = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return iso;
  const [y, m, d] = ymd.split("-");
  return `${Number(d)}. ${Number(m)}. ${y}`;
}
