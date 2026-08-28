"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
} from "chart.js";
import type { ChartData, ChartOptions } from "chart.js";
import { Pie } from "react-chartjs-2";
import { HeaderBrand, HeaderSectionSelect } from "../components/HeaderNav";
import { formatLastSyncDisplay } from "@/lib/formatLastSync";
import {
  aggregatePieSlices,
  CASHFLOW_PIE_COLORS,
  monthKeyFromRow,
  type CashflowEnrichedTx,
} from "@/lib/cashflowPie";
import CashflowTxnTable from "./CashflowTxnTable";
import CashflowRunwayChart from "./CashflowRunwayChart";

ChartJS.register(ArcElement, Tooltip, Legend);

type MonthRow = {
  year: number;
  month: number;
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
  transactions?: CashflowEnrichedTx[];
};

const TEXT = "#1a1f28";

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

function buildPieChartData(
  slices: ReturnType<typeof aggregatePieSlices>
): ChartData<"pie"> | null {
  if (!slices.length) return null;
  return {
    labels: slices.map((s) =>
      s.label.length > 32 ? `${s.label.slice(0, 30)}…` : s.label
    ),
    datasets: [
      {
        data: slices.map((s) => s.total),
        backgroundColor: slices.map(
          (_, i) => CASHFLOW_PIE_COLORS[i % CASHFLOW_PIE_COLORS.length]
        ),
        borderWidth: 0,
        borderColor: "transparent",
        hoverBorderWidth: 0,
      },
    ],
  };
}

export default function CashflowClient() {
  const [data, setData] = useState<CashflowPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [creditMonth, setCreditMonth] = useState("");
  const [debitMonth, setDebitMonth] = useState("");
  const [pdfExporting, setPdfExporting] = useState(false);
  const pdfExportRef = useRef<HTMLDivElement>(null);

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
  const transactions = data?.transactions ?? [];

  const monthOptions = useMemo(
    () =>
      (data?.months ?? []).map((m) => ({
        value: monthKeyFromRow(m.year, m.month),
        label: m.label.replace("*", " (prebieha)"),
      })),
    [data?.months]
  );

  const creditSlices = useMemo(
    () => aggregatePieSlices(transactions, "credit", creditMonth),
    [transactions, creditMonth]
  );
  const debitSlices = useMemo(
    () => aggregatePieSlices(transactions, "debit", debitMonth),
    [transactions, debitMonth]
  );

  const creditPieData = useMemo(
    () => buildPieChartData(creditSlices),
    [creditSlices]
  );
  const debitPieData = useMemo(
    () => buildPieChartData(debitSlices),
    [debitSlices]
  );

  const pieOptions = useCallback(
    (
      slices: ReturnType<typeof aggregatePieSlices>
    ): ChartOptions<"pie"> => ({
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 1.15,
      elements: {
        arc: {
          borderWidth: 0,
          borderColor: "transparent",
          hoverBorderWidth: 0,
        },
      },
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: TEXT,
            font: { family: "Manrope, sans-serif", size: 11 },
            padding: 10,
            boxWidth: 12,
          },
        },
        tooltip: {
          callbacks: {
            label(ctx) {
              const slice = slices[ctx.dataIndex];
              if (!slice) return "";
              const total = slices.reduce((s, r) => s + r.total, 0);
              const pct =
                total > 0
                  ? ((slice.total / total) * 100).toFixed(1)
                  : "0";
              return [
                slice.label,
                `${formatMoney(slice.total, currency)} (${pct} %)`,
                `${slice.count} ${slice.count === 1 ? "pohyb" : slice.count < 5 ? "pohyby" : "pohybov"}`,
              ];
            },
          },
        },
      },
    }),
    [currency]
  );

  const buildMarkdown = useCallback((): string => {
    if (!data) return "";
    const c = data.meta.currency;
    const fm = (n: number) => formatMoney(n, c);
    let md = `# Cash Flow — ${data.meta.accountLabel}\n\n`;
    md += `> Pohyby od ${data.meta.periodStart.slice(0, 10)} · sync banky ${data.meta.lastSync ?? "–"}\n\n`;
    md += `| KPI | Hodnota |\n|---|---|\n`;
    md += `| Aktuálny zostatok | ${fm(data.kpis.currentBalance)} |\n`;
    md += `| Netto od 1. 1. | ${fm(data.kpis.ytdNet)} |\n\n`;
    md += `## Súhrn po mesiacoch\n\n`;
    md += `| Mesiac | Počiatočný | + príjmy | − výdaje | Netto | Zostatok |\n`;
    md += `|---|---|---|---|---|---|\n`;
    for (const m of data.months) {
      md += `| ${m.label} | ${fm(m.opening)} | ${fm(m.credit)} | ${fm(m.debit)} | ${fm(m.net)} | ${fm(m.closing)} |\n`;
    }
    md += `\n> Cash runway (forecast sep–dec 2026) je v dashboarde pod touto tabuľkou.\n`;
    return md;
  }, [data]);

  const downloadMd = useCallback(() => {
    const md = buildMarkdown();
    if (!md) return;
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cashflow-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [buildMarkdown]);

  const downloadPdf = useCallback(async () => {
    const root = pdfExportRef.current;
    if (!root || !data) return;
    setPdfExporting(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      const canvas = await html2canvas(root, {
        scale: 1.75,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
        scrollX: 0,
        scrollY: -window.scrollY,
        windowWidth: root.scrollWidth,
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW;
      const imgH = (canvas.height * imgW) / canvas.width;
      let heightLeft = imgH;
      let y = 0;
      pdf.addImage(imgData, "PNG", 0, y, imgW, imgH);
      heightLeft -= pageH;
      while (heightLeft > 0) {
        y = heightLeft - imgH;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, y, imgW, imgH);
        heightLeft -= pageH;
      }
      pdf.save(`cashflow-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
      console.error(e);
      window.alert(e instanceof Error ? e.message : "Export do PDF zlyhal.");
    } finally {
      setPdfExporting(false);
    }
  }, [data]);

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
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginBottom: "0.5rem" }}>
              <button type="button" className="btn btn--outline btn--sm" onClick={downloadMd}>
                Stiahnuť MD
              </button>
              <button type="button" className="btn btn--outline btn--sm" onClick={downloadPdf} disabled={pdfExporting}>
                {pdfExporting ? "Generujem PDF…" : "Stiahnuť PDF"}
              </button>
            </div>

            <div className="dashboard-pdf-root" ref={pdfExportRef}>
            <p className="dashboard-period-hint">
              Účet {data.meta.accountLabel} · pohyby od{" "}
              {data.meta.periodStart.slice(0, 10)} · sync banky{" "}
              {formatLastSyncDisplay(data.meta.lastSync)}
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

            <CashflowRunwayChart months={data.months} currency={currency} />

            <div className="charts-row charts-row--cashflow-pies">
              <section className="chart-card chart-card--cashflow-pie">
                <div className="chart-card__head chart-card__head--filter">
                  <h2>Príjmy podľa protistrany</h2>
                  <div className="period-filter period-filter--cashflow-month">
                    <label className="period-filter__label" htmlFor="cashflow-credit-month">
                      Mesiac
                    </label>
                    <select
                      id="cashflow-credit-month"
                      className="period-filter__select"
                      value={creditMonth}
                      onChange={(e) => setCreditMonth(e.target.value)}
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
                {creditPieData ? (
                  <div className="cashflow-pie-wrap">
                    <Pie
                      data={creditPieData}
                      options={pieOptions(creditSlices)}
                    />
                  </div>
                ) : (
                  <p className="msg">Žiadne príjmy v zvolenom období.</p>
                )}
              </section>

              <section className="chart-card chart-card--cashflow-pie">
                <div className="chart-card__head chart-card__head--filter">
                  <h2>Výdavky podľa protistrany</h2>
                  <div className="period-filter period-filter--cashflow-month">
                    <label className="period-filter__label" htmlFor="cashflow-debit-month">
                      Mesiac
                    </label>
                    <select
                      id="cashflow-debit-month"
                      className="period-filter__select"
                      value={debitMonth}
                      onChange={(e) => setDebitMonth(e.target.value)}
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
                {debitPieData ? (
                  <div className="cashflow-pie-wrap">
                    <Pie data={debitPieData} options={pieOptions(debitSlices)} />
                  </div>
                ) : (
                  <p className="msg">Žiadne výdavky v zvolenom období.</p>
                )}
              </section>
            </div>

            <CashflowTxnTable
              transactions={transactions}
              currency={currency}
              monthOptions={monthOptions}
            />
            </div>
          </>
        ) : null}
      </main>
    </>
  );
}
