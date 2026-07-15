"use client";

import { useMemo, useState } from "react";
import {
  buildCashflowTableRows,
  EMPTY_CASHFLOW_TABLE_FILTERS,
  filterCashflowTableRows,
  formatCashflowDate,
  type CashflowTableFilters,
} from "@/lib/cashflowTable";
import type { CashflowEnrichedTx } from "@/lib/cashflowPie";

type MonthOption = { value: string; label: string };

type Props = {
  transactions: CashflowEnrichedTx[];
  currency: string;
  monthOptions: MonthOption[];
};

function formatMoney(n: number, currency: string): string {
  return new Intl.NumberFormat("sk-SK", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function amountClass(n: number): string {
  if (n > 0) return "cashflow-num cashflow-num--pos";
  if (n < 0) return "cashflow-num cashflow-num--neg";
  return "cashflow-num";
}

function updateFilter<K extends keyof CashflowTableFilters>(
  prev: CashflowTableFilters,
  key: K,
  value: CashflowTableFilters[K]
): CashflowTableFilters {
  return { ...prev, [key]: value };
}

export default function CashflowTxnTable({
  transactions,
  currency,
  monthOptions,
}: Props) {
  const [filters, setFilters] = useState<CashflowTableFilters>(
    EMPTY_CASHFLOW_TABLE_FILTERS
  );

  const allRows = useMemo(
    () => buildCashflowTableRows(transactions),
    [transactions]
  );
  const filteredRows = useMemo(
    () => filterCashflowTableRows(allRows, filters),
    [allRows, filters]
  );
  const filteredSum = useMemo(
    () => filteredRows.reduce((s, r) => s + r.amount, 0),
    [filteredRows]
  );

  const set = <K extends keyof CashflowTableFilters>(
    key: K,
    value: CashflowTableFilters[K]
  ) => {
    setFilters((prev) => updateFilter(prev, key, value));
  };

  return (
    <section className="table-card cashflow-txn-table" aria-labelledby="cashflow-txn-title">
      <div className="cashflow-txn-table__head">
        <div>
          <h2 id="cashflow-txn-title">Pohyby na účte</h2>
          <p className="chart-card__subtitle">
            Všetky transakcie s kategóriou · filtre v hlavičke stĺpcov ·{" "}
            zobrazených {filteredRows.length} z {allRows.length}
            {filteredSum !== 0
              ? ` · súčet ${formatMoney(filteredSum, currency)}`
              : ""}
          </p>
        </div>
        <div className="period-filter">
          <label className="period-filter__label" htmlFor="cashflow-txn-month">
            Mesiac
          </label>
          <select
            id="cashflow-txn-month"
            className="period-filter__select"
            value={filters.month}
            onChange={(e) => set("month", e.target.value)}
          >
            <option value="">Všetky mesiace</option>
            {monthOptions.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="table-scroll">
        <table className="data-table data-table--filterable">
          <thead>
            <tr>
              <th>Dátum</th>
              <th>Smer</th>
              <th>Kategória</th>
              <th>Protistrana</th>
              <th className="num">Suma</th>
              <th>Poznámka</th>
            </tr>
            <tr className="data-table__filter-row">
              <th>
                <input
                  type="text"
                  className="data-table__filter-input"
                  placeholder="Filter…"
                  value={filters.date}
                  onChange={(e) => set("date", e.target.value)}
                  aria-label="Filter dátum"
                />
              </th>
              <th>
                <select
                  className="data-table__filter-input"
                  value={filters.direction}
                  onChange={(e) =>
                    set("direction", e.target.value as CashflowTableFilters["direction"])
                  }
                  aria-label="Filter smer"
                >
                  <option value="">Všetko</option>
                  <option value="credit">Kredit</option>
                  <option value="debit">Debet</option>
                </select>
              </th>
              <th>
                <input
                  type="text"
                  className="data-table__filter-input"
                  placeholder="Filter…"
                  value={filters.category}
                  onChange={(e) => set("category", e.target.value)}
                  aria-label="Filter kategória"
                />
              </th>
              <th>
                <input
                  type="text"
                  className="data-table__filter-input"
                  placeholder="Filter…"
                  value={filters.counterparty}
                  onChange={(e) => set("counterparty", e.target.value)}
                  aria-label="Filter protistrana"
                />
              </th>
              <th>
                <input
                  type="text"
                  className="data-table__filter-input data-table__filter-input--num"
                  placeholder="Filter…"
                  value={filters.amount}
                  onChange={(e) => set("amount", e.target.value)}
                  aria-label="Filter suma"
                />
              </th>
              <th>
                <input
                  type="text"
                  className="data-table__filter-input"
                  placeholder="Filter…"
                  value={filters.remittance}
                  onChange={(e) => set("remittance", e.target.value)}
                  aria-label="Filter poznámka"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="msg">
                  Žiadny pohyb nevyhovuje filtrom.
                </td>
              </tr>
            ) : (
              filteredRows.map((row, idx) => (
                <tr key={`${row.booking_date}-${row.amount}-${idx}`}>
                  <td>{formatCashflowDate(row.booking_date)}</td>
                  <td>
                    <span className={`cashflow-dir cashflow-dir--${row.direction}`}>
                      {row.directionLabel}
                    </span>
                  </td>
                  <td>{row.categoryLabel}</td>
                  <td>{row.counterparty}</td>
                  <td className={`num ${amountClass(row.amount)}`}>
                    {formatMoney(row.amount, currency)}
                  </td>
                  <td className="cashflow-txn-note" title={row.remittance || undefined}>
                    {row.remittance || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {filteredRows.length > 0 ? (
            <tfoot>
              <tr>
                <td colSpan={4}>
                  <strong>Súčet filtrovaných pohybov</strong>
                </td>
                <td className={`num ${amountClass(filteredSum)}`}>
                  <strong>{formatMoney(filteredSum, currency)}</strong>
                </td>
                <td />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </section>
  );
}
