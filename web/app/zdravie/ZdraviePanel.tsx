"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArcElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Doughnut, Line } from "react-chartjs-2";
import CashflowRunwayChart from "../cashflow/CashflowRunwayChart";
import { formatLastSyncDisplay } from "@/lib/formatLastSync";
import type { CashflowMonthRow } from "@/lib/cashflowMonthly";
import {
  RUNWAY_SCENARIO_ORDER,
  type RunwayScenarioId,
} from "@/lib/cashflowRunway";
import type {
  ZdravieCashPressure,
  ZdravieJoinedMonth,
  ZdravieKpis,
  ZdravieRunwaySummary,
} from "@/lib/zdravieMetrics";
import type { ZdravieBucket } from "@/lib/zdravieBuckets";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler
);

const TEXT = "#1a1f28";
const GRID = "rgba(15, 23, 42, 0.06)";
const CM_COLOR = "#6b7f62";
const CASH_COLOR = "#1a1f28";

type ZdraviePayload = {
  meta: {
    accountLabel: string;
    periodStart: string;
    currency: string;
    lastSync: string | null;
    pnlNote: string;
    pnlYear: string;
    mode: "hybrid";
    cogsRate: number;
  };
  kpis: ZdravieKpis;
  months: ZdravieJoinedMonth[];
  cashMonths: CashflowMonthRow[];
  runway: ZdravieRunwaySummary | null;
  pressures: {
    owner: ZdravieCashPressure;
    orin: ZdravieCashPressure;
  };
  costMix: {
    cogs: number;
    marketing: number;
    staff: number;
    otherOpex: number;
  };
  costStructure?: {
    buckets: ZdravieBucket[];
    pnlTotal: number;
    revenueYtd: number;
    costsOverRevenue: boolean;
    costsOverPct: number | null;
  };
};

function formatMoney(n: number, currency = "EUR", digits = 0): string {
  return new Intl.NumberFormat("sk-SK", {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

function formatPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "–";
  return new Intl.NumberFormat("sk-SK", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(n);
}

function netClass(n: number): string {
  if (n > 0) return "cashflow-num cashflow-num--pos";
  if (n < 0) return "cashflow-num cashflow-num--neg";
  return "cashflow-num";
}

function toneForBalance(n: number, buffer: number): string {
  if (n < 0) return "cashflow-num cashflow-num--neg";
  if (n < buffer) return "kpi-card__value--warn";
  return "cashflow-num cashflow-num--pos";
}

function marginTone(margin: number | null): string {
  if (margin == null) return "";
  if (margin >= 0.1) return "cashflow-num cashflow-num--pos";
  if (margin >= 0) return "kpi-card__value--warn";
  return "cashflow-num cashflow-num--neg";
}

export default function ZdraviePanel() {
  const [data, setData] = useState<ZdraviePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [scenario, setScenario] = useState<RunwayScenarioId>("base");

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/zdravie", { cache: "no-store" });
      const body = (await res.json()) as ZdraviePayload & { error?: string };
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
  const buffer = data?.runway?.bufferEur ?? 3000;

  const scissorsData = useMemo((): ChartData<"line"> | null => {
    if (!data) return null;
    const rows = data.months.filter(
      (m) => m.contribution_margin != null || m.cash_close != null
    );
    if (!rows.length) return null;
    return {
      labels: rows.map((m) => m.label.replace(/\s+\d{4}$/, "")),
      datasets: [
        {
          label: "Hybrid CM",
          data: rows.map((m) => m.contribution_margin),
          borderColor: CM_COLOR,
          backgroundColor: "transparent",
          borderWidth: 2.5,
          pointRadius: 3,
          tension: 0.15,
          yAxisID: "y",
          spanGaps: true,
        },
        {
          label: "Cash close",
          data: rows.map((m) => m.cash_close),
          borderColor: CASH_COLOR,
          backgroundColor: "transparent",
          borderWidth: 2.5,
          borderDash: [5, 4],
          pointRadius: 3,
          tension: 0.15,
          yAxisID: "y1",
          spanGaps: true,
        },
      ],
    };
  }, [data]);

  const scissorsOpts = useMemo(
    (): ChartOptions<"line"> => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: TEXT,
            font: { family: "Manrope, sans-serif", size: 11 },
            boxWidth: 12,
          },
        },
        tooltip: {
          callbacks: {
            label(ctx) {
              const v = ctx.parsed.y;
              if (v == null || !Number.isFinite(v)) {
                return `${ctx.dataset.label}: –`;
              }
              return `${ctx.dataset.label}: ${formatMoney(v, currency)}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: GRID },
          ticks: { color: TEXT, font: { size: 11 } },
        },
        y: {
          position: "left",
          title: {
            display: true,
            text: "Hybrid CM (€)",
            color: TEXT,
            font: { size: 11 },
          },
          grid: { color: GRID },
          ticks: {
            color: TEXT,
            callback: (v) => formatMoney(Number(v), currency),
          },
        },
        y1: {
          position: "right",
          title: {
            display: true,
            text: "Cash close (€)",
            color: TEXT,
            font: { size: 11 },
          },
          grid: { drawOnChartArea: false },
          ticks: {
            color: TEXT,
            callback: (v) => formatMoney(Number(v), currency),
          },
        },
      },
    }),
    [currency]
  );

  const costMixData = useMemo((): ChartData<"doughnut"> | null => {
    if (!data?.costStructure) return null;
    const pnlBuckets = data.costStructure.buckets.filter((b) => b.kind === "pnl");
    if (!pnlBuckets.length) return null;
    return {
      labels: pnlBuckets.map((b) => b.label),
      datasets: [
        {
          data: pnlBuckets.map((b) => b.amount),
          backgroundColor: pnlBuckets.map((b) => b.color),
          borderWidth: 0,
        },
      ],
    };
  }, [data]);

  const costMixOpts = useMemo(
    (): ChartOptions<"doughnut"> => ({
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 1.2,
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: TEXT,
            font: { family: "Manrope, sans-serif", size: 11 },
            boxWidth: 12,
            padding: 10,
          },
        },
        tooltip: {
          callbacks: {
            label(ctx) {
              const v = Number(ctx.raw);
              const total = (ctx.dataset.data as number[]).reduce(
                (s, n) => s + Number(n),
                0
              );
              const pct = total > 0 ? ((v / total) * 100).toFixed(1) : "0";
              return `${ctx.label}: ${formatMoney(v, currency)} (${pct} %)`;
            },
          },
        },
      },
    }),
    [currency]
  );

  const cmTrendData = useMemo((): ChartData<"line"> | null => {
    if (!data) return null;
    const rows = data.months.filter((m) => m.contribution_margin != null);
    if (!rows.length) return null;
    return {
      labels: rows.map((m) => m.label.replace(/\s+\d{4}$/, "")),
      datasets: [
        {
          label: "Hybrid CM",
          data: rows.map((m) => m.contribution_margin as number),
          borderColor: CM_COLOR,
          backgroundColor: "hsla(95, 18%, 45%, 0.12)",
          fill: true,
          borderWidth: 2,
          tension: 0.2,
          pointRadius: 3,
        },
        {
          label: "Nula",
          data: rows.map(() => 0),
          borderColor: "hsl(0, 50%, 42%)",
          borderWidth: 1,
          borderDash: [4, 4],
          pointRadius: 0,
          fill: false,
        },
      ],
    };
  }, [data]);

  const cmTrendOpts = useMemo(
    (): ChartOptions<"line"> => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: TEXT,
            font: { family: "Manrope, sans-serif", size: 11 },
            boxWidth: 12,
            filter: (item) => item.text !== "Nula",
          },
        },
        tooltip: {
          callbacks: {
            label(ctx) {
              if (ctx.dataset.label === "Nula") return "";
              const v = ctx.parsed.y;
              if (v == null) return "";
              return `CM: ${formatMoney(v, currency)}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: GRID },
          ticks: { color: TEXT, font: { size: 11 } },
        },
        y: {
          grid: { color: GRID },
          ticks: {
            color: TEXT,
            callback: (v) => formatMoney(Number(v), currency),
          },
        },
      },
    }),
    [currency]
  );

  if (loading && !data) return <p className="msg">Načítavam finančné zdravie…</p>;
  if (err) {
    return (
      <p className="msg msg-error" role="alert">
        {err}
      </p>
    );
  }
  if (!data) return null;

  const { kpis, runway, pressures, meta } = data;
  const scMeta = runway?.scenarioMeta[scenario];

  return (
    <div className="dashboard-pdf-root zdravie-root">
      <p className="dashboard-period-hint">
        Hybrid P&L {meta.pnlYear} · účet {meta.accountLabel} · sync banky{" "}
        {formatLastSyncDisplay(meta.lastSync)} · COGS{" "}
        {(meta.cogsRate * 100).toFixed(0)} % z tovaru
      </p>
      <p className="chart-card__subtitle zdravie-lead">{meta.pnlNote}</p>

      <header className="zdravie-section-head">
        <h2 className="zdravie-section-head__title">1. Okamžitý stav a runway</h2>
        <p className="zdravie-section-head__sub">Liquidity &amp; Survival</p>
        <p className="zdravie-section-head__lead">
          Hotovosť na hlavnom Tatra účte a projekcia do konca roka (základný
          scenár).
        </p>
      </header>

      <section className="kpi-section" aria-label="Likvidita">
        <div className="kpi-grid kpi-grid--hero">
          <div className="kpi-card kpi-card--hero">
            <span className="kpi-card__label">Aktuálny zostatok</span>
            <span
              className={`kpi-card__value ${toneForBalance(kpis.currentBalance, buffer)}`}
            >
              {formatMoney(kpis.currentBalance, currency)}
            </span>
          </div>
          <div className="kpi-card kpi-card--hero">
            <span className="kpi-card__label">
              Cash YE · {scMeta?.short ?? "Základný"}
            </span>
            <span
              className={`kpi-card__value ${toneForBalance(
                runway?.yearEnd[scenario] ?? 0,
                buffer
              )}`}
            >
              {runway
                ? formatMoney(runway.yearEnd[scenario], currency)
                : "–"}
            </span>
            <span className="kpi-card__suffix">
              {runway?.untilLabel[scenario] ?? ""}
            </span>
          </div>
          <div className="kpi-card kpi-card--hero">
            <span className="kpi-card__label">Minimum do YE</span>
            <span
              className={`kpi-card__value ${toneForBalance(
                runway?.minFromNow[scenario] ?? 0,
                buffer
              )}`}
            >
              {runway
                ? formatMoney(runway.minFromNow[scenario], currency)
                : "–"}
            </span>
            <span className="kpi-card__suffix">
              bez výberov YE{" "}
              {runway
                ? formatMoney(runway.yearEndNoOwner[scenario], currency)
                : "–"}
            </span>
          </div>
        </div>

        <div className="kpi-grid kpi-grid--secondary">
          <div className="kpi-card">
            <span className="kpi-card__label">Netto cash od 1. 1.</span>
            <span className={`kpi-card__value ${netClass(kpis.ytdNetCash)}`}>
              {formatMoney(kpis.ytdNetCash, currency)}
            </span>
          </div>
          <div className="kpi-card">
            <span className="kpi-card__label">Výbery majiteľa YTD</span>
            <span className="kpi-card__value cashflow-num--neg">
              {formatMoney(pressures.owner.ytd, currency)}
            </span>
            <span className="kpi-card__suffix">
              {pressures.owner.count} pohybov (odhad podľa mena)
            </span>
          </div>
          <div className="kpi-card">
            <span className="kpi-card__label">Nákupy ORIN YTD</span>
            <span className="kpi-card__value cashflow-num--neg">
              {formatMoney(pressures.orin.ytd, currency)}
            </span>
            <span className="kpi-card__suffix">
              {pressures.orin.count} pohybov · cash, nie COGS timing
            </span>
          </div>
          <div className="kpi-card">
            <span className="kpi-card__label">Stav k 1. 1. (dopočítaný)</span>
            <span className="kpi-card__value">
              {formatMoney(kpis.openingAtPeriodStart, currency)}
            </span>
          </div>
          <div className="kpi-card">
            <span className="kpi-card__label">Vankúš</span>
            <span className="kpi-card__value">
              {formatMoney(buffer, currency)}
            </span>
            <span className="kpi-card__suffix">cieľová rezerva</span>
          </div>
        </div>

        {runway ? (
          <div className="zdravie-scenario-pills" role="group" aria-label="Scenár">
            {RUNWAY_SCENARIO_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                className={
                  scenario === id
                    ? "zdravie-scenario-pill is-active"
                    : "zdravie-scenario-pill"
                }
                onClick={() => setScenario(id)}
              >
                {runway.scenarioMeta[id].label}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <header className="zdravie-section-head">
        <h2 className="zdravie-section-head__title">
          2. Výkonnosť — hybrid P&amp;L
        </h2>
        <p className="zdravie-section-head__sub">Ekonomický zisk</p>
        <p className="zdravie-section-head__lead">
          Tržby a OPEX z XLS, COGS = 42 % čistých tržieb za tovar (nie nákup 504).
        </p>
      </header>

      <section className="kpi-section" aria-label="Výkonnosť">
        <div className="kpi-grid kpi-grid--hero">
          <div className="kpi-card kpi-card--hero">
            <span className="kpi-card__label">Tržby YTD</span>
            <span className="kpi-card__value">
              {formatMoney(kpis.revenueYtd, currency)}
            </span>
          </div>
          <div className="kpi-card kpi-card--hero">
            <span className="kpi-card__label">Hybrid CM YTD</span>
            <span className={`kpi-card__value ${netClass(kpis.cmYtd)}`}>
              {formatMoney(kpis.cmYtd, currency)}
            </span>
            <span className="kpi-card__suffix">
              marža {formatPct(kpis.marginYtd)}
            </span>
          </div>
          <div className="kpi-card kpi-card--hero">
            <span className="kpi-card__label">3M hybrid marža</span>
            <span className={`kpi-card__value ${marginTone(kpis.margin3m)}`}>
              {formatPct(kpis.margin3m)}
            </span>
            <span className="kpi-card__suffix">
              CM {formatMoney(kpis.cm3m, currency)} · cieľ &gt; 10 %
            </span>
          </div>
        </div>

        <div className="kpi-grid kpi-grid--secondary">
          <div className="kpi-card">
            <span className="kpi-card__label">COGS YTD</span>
            <span className="kpi-card__value">
              {formatMoney(kpis.cogsYtd, currency)}
            </span>
          </div>
          <div className="kpi-card">
            <span className="kpi-card__label">OPEX YTD</span>
            <span className="kpi-card__value">
              {formatMoney(kpis.opexYtd, currency)}
            </span>
          </div>
          <div className="kpi-card">
            <span className="kpi-card__label">Marketing YTD</span>
            <span className="kpi-card__value">
              {formatMoney(kpis.marketingYtd, currency)}
            </span>
            <span className="kpi-card__suffix">
              {formatPct(kpis.marketingPct)} z tržieb
            </span>
          </div>
          <div className="kpi-card">
            <span className="kpi-card__label">Staff YTD</span>
            <span className="kpi-card__value">
              {formatMoney(kpis.staffYtd, currency)}
            </span>
            <span className="kpi-card__suffix">
              {formatPct(kpis.staffPct)} z tržieb
            </span>
          </div>
          <div className="kpi-card">
            <span className="kpi-card__label">P&amp;L do</span>
            <span className="kpi-card__value" style={{ fontSize: "1.15rem" }}>
              {kpis.pnlLastMonthKey ?? "–"}
            </span>
            <span className="kpi-card__suffix">
              detail na <a href="/pnl">/pnl</a>
            </span>
          </div>
        </div>
      </section>

      <header className="zdravie-section-head zdravie-section-head--viz">
        <h2 className="zdravie-section-head__title">Vizualizácie</h2>
        <p className="zdravie-section-head__lead">
          Hybrid CM vs. cash (rôzne škály), trend CM a rozpad nákladov.
        </p>
      </header>

      <div className="charts-row">
        <section
          className="chart-card"
          aria-labelledby="zdravie-scissors-title"
        >
          <h2 id="zdravie-scissors-title">Hybrid CM vs. cash close</h2>
          <p className="chart-card__subtitle">
            Ľavá os = ekonomický CM · pravá = zostatok Tatra (nožnice P&amp;L ≠
            cash)
          </p>
          <div className="zdravie-chart-wrap">
            {scissorsData ? (
              <Line data={scissorsData} options={scissorsOpts} />
            ) : (
              <p className="msg">Žiadne mesačné dáta</p>
            )}
          </div>
        </section>

        <section className="chart-card" aria-labelledby="zdravie-mix-title">
          <h2 id="zdravie-mix-title">Rozpad nákladov YTD</h2>
          <p className="chart-card__subtitle">
            Hybrid: COGS 42 % + OPEX z XLS
          </p>
          {costMixData ? (
            <Doughnut data={costMixData} options={costMixOpts} />
          ) : (
            <p className="msg">Žiadne náklady</p>
          )}
        </section>
      </div>

      <div className="charts-row charts-row--single">
        <section className="chart-card" aria-labelledby="zdravie-cm-title">
          <h2 id="zdravie-cm-title">Trend hybrid CM</h2>
          <p className="chart-card__subtitle">Mesačný ekonomický zisk</p>
          <div className="zdravie-chart-wrap zdravie-chart-wrap--short">
            {cmTrendData ? (
              <Line data={cmTrendData} options={cmTrendOpts} />
            ) : null}
          </div>
        </section>
      </div>

      {data.cashMonths.length > 0 ? (
        <CashflowRunwayChart months={data.cashMonths} currency={currency} />
      ) : null}

      {data.costStructure && data.costStructure.buckets.length > 0 ? (
        <>
          <header className="zdravie-section-head">
            <h2 className="zdravie-section-head__title">
              4. Nákladová štruktúra{" "}
              <span className="zdravie-section-head__sep">|</span> Akčné páky
            </h2>
            <p className="zdravie-section-head__sub">Hybrid P&amp;L + cash</p>
            <p className="zdravie-section-head__lead">
              Rozpad nákladov vs. D2C benchmark a cash páky (výbery, ORIN).
              Kritické riadky sú zvýraznené.
            </p>
          </header>

          <section
            className="table-card"
            aria-labelledby="zdravie-buckets-title"
          >
            <h2 id="zdravie-buckets-title" className="visually-hidden">
              Nákladová štruktúra
            </h2>
            <p className="chart-card__subtitle">
              Hybrid YTD · COGS 42 % z tovaru · cash páky mimo P&amp;L súčtu
            </p>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Skupina</th>
                    <th className="num">Výška</th>
                    <th className="num">% nákladov</th>
                    <th className="num">% tržieb</th>
                    <th>Benchmark</th>
                    <th>Odporúčaná akcia</th>
                  </tr>
                </thead>
                <tbody>
                  {data.costStructure.buckets.map((b) => (
                    <tr key={b.key}>
                      <td>
                        <span
                          className="zdravie-bucket-swatch"
                          style={{ background: b.color }}
                          aria-hidden
                        />
                        {b.label}
                        {b.kind === "cash" ? (
                          <span className="zdravie-bucket-tag"> cash</span>
                        ) : null}
                      </td>
                      <td className="num">
                        {formatMoney(b.amount, currency)}
                      </td>
                      <td className="num">{formatPct(b.pctOfCosts)}</td>
                      <td className="num">{formatPct(b.pctOfRevenue)}</td>
                      <td className="zdravie-bucket-bench">{b.benchLabel}</td>
                      <td
                        className={
                          b.actionCrit ? "zdravie-action-crit" : undefined
                        }
                      >
                        {b.action}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Spolu (P&amp;L)</td>
                    <td className="num">
                      {formatMoney(data.costStructure.pnlTotal, currency)}
                    </td>
                    <td className="num">100,0 %</td>
                    <td className="num">
                      {formatPct(data.costStructure.costsOverPct)}
                    </td>
                    <td colSpan={2}>
                      {data.costStructure.costsOverRevenue &&
                      data.costStructure.costsOverPct != null
                        ? `Náklady presahujú tržby o ${((data.costStructure.costsOverPct - 1) * 100).toLocaleString("sk-SK", { maximumFractionDigits: 1 })} %`
                        : "—"}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="chart-card__subtitle zdravie-bucket-links">
              Detail: <a href="/pnl">P&amp;L</a> ·{" "}
              <a href="/cashflow">Cash flow</a> ·{" "}
              <a href="/scaling">Spend</a>
            </p>
          </section>
        </>
      ) : null}

      <header className="zdravie-section-head">
        <h2 className="zdravie-section-head__title">
          Mesačný mostík · hybrid + cash
        </h2>
        <p className="zdravie-section-head__lead">
          Jedna tabuľka — P&amp;L a cash vedľa seba. * = neuzavretý mesiac.
        </p>
      </header>

      <section className="table-card" aria-labelledby="zdravie-monthly-title">
        <h2 id="zdravie-monthly-title" className="visually-hidden">
          Mesačná tabuľka
        </h2>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mesiac</th>
                <th className="num">Tržby</th>
                <th className="num">Hybrid CM</th>
                <th className="num">Marža</th>
                <th className="num">Cash netto</th>
                <th className="num">Cash close</th>
              </tr>
            </thead>
            <tbody>
              {data.months.map((m) => (
                <tr key={m.month_key}>
                  <td>
                    {m.label}
                    {m.isPartial ? "*" : ""}
                  </td>
                  <td className="num">
                    {m.revenue != null
                      ? formatMoney(m.revenue, currency)
                      : "–"}
                  </td>
                  <td
                    className={`num ${
                      m.contribution_margin != null
                        ? netClass(m.contribution_margin)
                        : ""
                    }`}
                  >
                    {m.contribution_margin != null
                      ? formatMoney(m.contribution_margin, currency)
                      : "–"}
                  </td>
                  <td className="num">{formatPct(m.margin_pct)}</td>
                  <td
                    className={`num ${
                      m.cash_net != null ? netClass(m.cash_net) : ""
                    }`}
                  >
                    {m.cash_net != null
                      ? formatMoney(m.cash_net, currency)
                      : "–"}
                  </td>
                  <td
                    className={`num ${
                      m.cash_close != null
                        ? toneForBalance(m.cash_close, buffer)
                        : ""
                    }`}
                  >
                    {m.cash_close != null
                      ? formatMoney(m.cash_close, currency)
                      : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="chart-card__subtitle">
        Drill-down: <a href="/pnl">P&amp;L</a> ·{" "}
        <a href="/cashflow">Cash flow</a>. Forecast scenáre sú odhad, nie
        bankový prísľub.
      </p>
    </div>
  );
}
