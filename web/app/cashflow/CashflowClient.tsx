"use client";

import { useCallback, useEffect, useState } from "react";
import { HeaderBrand, HeaderSectionSelect } from "../components/HeaderNav";
import { formatLastSyncDisplay } from "@/lib/formatLastSync";

type MonthRow = {
  label: string;
  isPartial: boolean;
  opening: number;
  credit: number;
  debit: number;
  net: number;
  closing: number;
};

type CashflowPayload = {
  meta: {
    accountLabel: string;
    periodStart: string;
    currency: string;
    lastSync: string | null;
    openingDerived: boolean;
  };
  kpis: {
    currentBalance: number;
    ytdNet: number;
    openingAtPeriodStart: number;
    transactionCount: number;
  };
  months: MonthRow[];
};

function formatMoney(n: number, currency: string): string {
  return new Intl.NumberFormat("sk-SK", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function netClass(n: number): string {
  if (n > 0) return "cashflow-num cashflow-num--pos";
  if (n < 0) return "cashflow-num cashflow-num--neg";
  return "cashflow-num";
}

export default function CashflowClient() {
  const [data, setData] = useState<CashflowPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/cashflow", { cache: "no-store" });
      const body = (await res.json()) as CashflowPayload & { error?: string };
      if (!res.ok) {
        setErr(body.error || `HTTP ${res.status}`);
        setData(null);
        return;
      }
      setData(body);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Načítanie zlyhalo");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const currency = data?.meta.currency ?? "EUR";

  return (
    <>
      <header className="site-header site-header--sklad">
        <div className="site-header__inner">
          <HeaderBrand />
          <div className="site-toolbar__filters site-toolbar__filters--under-brand">
            <HeaderSectionSelect />
          </div>
        </div>
      </header>

      <main className="main-wrap">
        {loading && !data ? <p className="msg">Načítavam cash flow…</p> : null}
        {err ? (
          <p className="msg msg-error" role="alert">
            {err}
          </p>
        ) : null}

        {data ? (
          <>
            <p className="dashboard-period-hint">
              Účet {data.meta.accountLabel} · pohyby od{" "}
              {data.meta.periodStart.slice(0, 10)} · sync banky{" "}
              {formatLastSyncDisplay(data.meta.lastSync)}
              {data.meta.openingDerived
                ? " · počiatočný stav k 1. 1. dopočítaný z aktuálneho zostatku"
                : null}
            </p>

            <section className="kpi-section" aria-label="Cash flow KPI">
              <div className="kpi-grid kpi-grid--hero">
                <div className="kpi-card kpi-card--hero">
                  <span className="kpi-card__label">Aktuálny zostatok</span>
                  <span className="kpi-card__value">
                    {formatMoney(data.kpis.currentBalance, currency)}
                  </span>
                </div>
                <div className="kpi-card kpi-card--hero">
                  <span className="kpi-card__label">Netto od 1. 1.</span>
                  <span className={`kpi-card__value ${netClass(data.kpis.ytdNet)}`}>
                    {formatMoney(data.kpis.ytdNet, currency)}
                  </span>
                </div>
              </div>
              <div className="kpi-grid kpi-grid--secondary">
                <div className="kpi-card">
                  <span className="kpi-card__label">Stav k 1. 1. (dopočítaný)</span>
                  <span className="kpi-card__value">
                    {formatMoney(data.kpis.openingAtPeriodStart, currency)}
                  </span>
                </div>
                <div className="kpi-card">
                  <span className="kpi-card__label">Počet pohybov v období</span>
                  <span className="kpi-card__value">{data.kpis.transactionCount}</span>
                </div>
              </div>
            </section>

            <section className="table-card" aria-labelledby="cashflow-monthly-title">
              <h2 id="cashflow-monthly-title">Súhrn po mesiacoch</h2>
              <p className="chart-card__subtitle">
                * aktuálny mesiac len do dnešného dňa (Europe/Bratislava)
              </p>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Mesiac</th>
                      <th className="num">Počiatočný stav</th>
                      <th className="num">+ príjmy</th>
                      <th className="num">− výdaje</th>
                      <th className="num">Netto</th>
                      <th className="num">Zostatok</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.months.map((row) => (
                      <tr key={row.label}>
                        <td>{row.label}</td>
                        <td className="num">{formatMoney(row.opening, currency)}</td>
                        <td className="num cashflow-num--pos">
                          {formatMoney(row.credit, currency)}
                        </td>
                        <td className="num cashflow-num--neg">
                          {formatMoney(row.debit, currency)}
                        </td>
                        <td className={`num ${netClass(row.net)}`}>
                          {formatMoney(row.net, currency)}
                        </td>
                        <td className="num">{formatMoney(row.closing, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {data.months.length > 0 ? (
                    <tfoot>
                      <tr>
                        <td colSpan={5} className="num">
                          <strong>Aktuálny zostatok (API)</strong>
                        </td>
                        <td className="num">
                          <strong>{formatMoney(data.kpis.currentBalance, currency)}</strong>
                        </td>
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              </div>
            </section>
          </>
        ) : null}
      </main>
    </>
  );
}
