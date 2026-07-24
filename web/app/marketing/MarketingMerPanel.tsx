"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chart as ChartJS, registerables } from "chart.js";
import type { ChartData, ChartOptions } from "chart.js";
import { Chart } from "react-chartjs-2";
import {
  currentCalendarYm,
  formatMonthLabelSk,
  ROLLING_RANGE_LABELS,
} from "@/lib/dashboardPeriodFilter";
import { previousPeriodLabel } from "@/lib/dashboardPeriodCompare";
import { KpiPeriodCompare } from "../components/KpiPeriodCompare";
import {
  buildMarketingMerMarkdown,
  downloadMarketingMarkdown,
} from "@/lib/marketingMarkdownExport";

ChartJS.register(...registerables);

/** Graf + tabuľka vždy od spustenia; scorecards vždy aktuálny mesiac (kpisMom). */
const SERIES_RANGE = "365d" as const;

type MerKpis = {
  revenue: number;
  orders: number;
  aov: number | null;
  ads_spend: number;
  fees_spend: number;
  agency_fees_spend?: number;
  total_mkt_spend: number;
  currency: string;
  mer: number | null;
  ad_roas: number | null;
  m_roas?: number | null;
};

type MerMonthRow = {
  month: string;
  revenue: number;
  orders: number;
  aov: number | null;
  ads_spend: number;
  fees_spend: number;
  agency_fees_spend?: number;
  total_mkt_spend: number;
  mer: number | null;
  ad_roas: number | null;
  m_roas?: number | null;
  mom_revenue_pct: number | null;
  yoy_revenue_pct: number | null;
};

type MerPayload = {
  meta: {
    range: string;
    from: string;
    to: string;
    launch_from?: string;
    journal_note?: string;
    compareFrom?: string;
    compareTo?: string;
    compareKind?: string;
    compareLabel?: string;
    momFrom?: string;
    momTo?: string;
  };
  kpis: MerKpis;
  /** Focus month KPIs for MoM delta (vs kpisPrevious). */
  kpisMom?: MerKpis | null;
  kpisPrevious?: MerKpis | null;
  monthly: MerMonthRow[];
  feesBreakdown: { label: string; amount_eur: number }[];
  unmappedExpenses: {
    label: string;
    line_text: string;
    debit_account: string;
    amount_eur: number;
  }[];
};

function formatMoney(n: number, currency = "EUR"): string {
  return new Intl.NumberFormat("sk-SK", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

function formatRatio(n: number | null | undefined, suffix = "×"): string {
  if (n == null) return "—";
  return `${n.toFixed(2)}${suffix}`;
}

export default function MarketingMerPanel() {
  const [data, setData] = useState<MerPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfExporting, setPdfExporting] = useState(false);
  const pdfExportRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const q = `?range=${SERIES_RANGE}&_=${Date.now()}`;
      const res = await fetch(`/api/marketing/mer${q}`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setData((await res.json()) as MerPayload);
    } catch (e) {
      setData(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const currency = data?.kpis.currency ?? "EUR";
  /** Scorecards: always focus (current) month — not period totals. */
  const kpis = data?.kpisMom ?? data?.kpis ?? null;
  const prev = data?.kpisPrevious ?? null;
  const scorecardMonthLabel = useMemo(() => {
    const from = data?.meta.momFrom?.slice(0, 7);
    if (from && /^\d{4}-\d{2}$/.test(from)) {
      return formatMonthLabelSk(from);
    }
    return formatMonthLabelSk(currentCalendarYm());
  }, [data?.meta.momFrom]);
  const compareLabel = useMemo(() => {
    if (!data?.meta.compareFrom || !data?.meta.compareTo) {
      return data?.meta.compareLabel ?? data?.meta.compareKind ?? "MoM";
    }
    const detail = previousPeriodLabel(data.meta.compareFrom, data.meta.compareTo);
    return `MoM · ${detail}`;
  }, [data]);

  const moneyFmt = useCallback(
    (v: number) => formatMoney(v, currency),
    [currency]
  );
  const ratioFmt = useCallback((v: number) => formatRatio(v), []);
  const intFmt = useCallback((v: number) => String(Math.round(v)), []);

  const downloadMd = useCallback(() => {
    if (!data || !kpis) return;
    const from = data.meta.from.replace(/\s/g, "");
    const to = data.meta.to.replace(/\s/g, "");
    const md = buildMarketingMerMarkdown({
      rangeLabel: `${scorecardMonthLabel} (scorecards) · ${ROLLING_RANGE_LABELS[SERIES_RANGE]}`,
      from: data.meta.from,
      to: data.meta.to,
      launchFrom: data.meta.launch_from,
      currency: kpis.currency,
      kpis,
      monthly: data.monthly,
      feesBreakdown: data.feesBreakdown,
      unmappedExpenses: data.unmappedExpenses,
    });
    downloadMarketingMarkdown(
      md,
      `marketing-mer-${SERIES_RANGE}_${from}_${to}.md`
    );
  }, [data, kpis, scorecardMonthLabel]);

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
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

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

      const from = data.meta.from.replace(/\s/g, "");
      const to = data.meta.to.replace(/\s/g, "");
      pdf.save(`marketing-mer-${SERIES_RANGE}_${from}_${to}.pdf`);
    } catch (e) {
      console.error(e);
      window.alert(
        e instanceof Error
          ? e.message
          : "Export do PDF zlyhal. Skús znova alebo iný prehliadač."
      );
    } finally {
      setPdfExporting(false);
    }
  }, [data]);

  const chartData: ChartData<"bar" | "line"> | null = useMemo(() => {
    if (!data?.monthly.length) return null;
    return {
      labels: data.monthly.map((r) => formatMonthLabelSk(`${r.month}-01`)),
      datasets: [
        {
          type: "bar" as const,
          label: "Revenue",
          data: data.monthly.map((r) => r.revenue),
          backgroundColor: "rgba(245, 197, 24, 0.85)",
          yAxisID: "y",
          order: 2,
        },
        {
          type: "line" as const,
          label: "Ads",
          data: data.monthly.map((r) => r.ads_spend),
          borderColor: "#5b8def",
          backgroundColor: "#5b8def",
          tension: 0.25,
          yAxisID: "y",
          order: 1,
        },
        {
          type: "line" as const,
          label: "Fees",
          data: data.monthly.map((r) => r.fees_spend),
          borderColor: "#e07b4a",
          backgroundColor: "#e07b4a",
          tension: 0.25,
          yAxisID: "y",
          order: 1,
        },
        {
          type: "line" as const,
          label: "Total MKT",
          data: data.monthly.map((r) => r.total_mkt_spend),
          borderColor: "#1a1f28",
          backgroundColor: "#1a1f28",
          tension: 0.25,
          yAxisID: "y",
          order: 0,
        },
      ],
    };
  }, [data]);

  const chartOptions: ChartOptions<"bar" | "line"> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#1a1f28", font: { family: "DM Sans, sans-serif" } },
        },
      },
      scales: {
        y: {
          ticks: { color: "#1a1f28" },
          grid: { color: "rgba(26,31,40,0.08)" },
        },
        x: {
          ticks: { color: "#1a1f28", maxRotation: 45 },
          grid: { display: false },
        },
      },
    }),
    []
  );

  if (loading) {
    return <p className="msg">Načítavam MER…</p>;
  }
  if (err) {
    return <p className="msg msg--error">{err}</p>;
  }
  if (!data || !kpis) {
    return <p className="msg">Žiadne dáta.</p>;
  }

  return (
    <div className="marketing-mer">
      <div
        className="site-toolbar__actions"
        style={{ marginBottom: "0.75rem" }}
      >
        <button
          type="button"
          className="dashboard-export-btn"
          onClick={downloadMd}
        >
          Stiahnuť MD
        </button>
        <button
          type="button"
          className="dashboard-export-btn dashboard-export-btn--accent"
          disabled={pdfExporting}
          aria-busy={pdfExporting}
          onClick={() => void downloadPdf()}
        >
          {pdfExporting ? "Generujem PDF…" : "Stiahnuť PDF"}
        </button>
      </div>

      <div className="dashboard-pdf-root" ref={pdfExportRef}>
        <h1 className="dashboard-card__title" style={{ marginBottom: "0.5rem" }}>
          MER — Marketing efficiency
        </h1>
        <p className="dashboard-meta">
          Scorecards: {scorecardMonthLabel}
          {" · "}
          Graf a tabuľka: {ROLLING_RANGE_LABELS[SERIES_RANGE]}
          {data.meta.launch_from ? ` (od ${data.meta.launch_from})` : null}
        </p>
        <p className="dashboard-meta dashboard-meta--hint">
          Ads = Meta CSV · Fees = denník (518/5015) · mROAS = Revenue / (Ads +
          Fees agentúry: Správa PPC) · Meta FP v denníku sa nepočíta dvakrát.
        </p>

        <div className="kpi-grid kpi-grid--marketing-mer">
          <div className="kpi-card">
            <span className="kpi-card__label">Revenue</span>
            <strong className="kpi-card__value">
              {formatMoney(kpis.revenue, currency)}
            </strong>
            <KpiPeriodCompare
              current={kpis.revenue}
              previous={prev?.revenue}
              formatValue={moneyFmt}
              periodLabel={compareLabel}
            />
          </div>
          <div className="kpi-card">
            <span className="kpi-card__label">Orders</span>
            <strong className="kpi-card__value">
              {(kpis.orders ?? 0).toLocaleString("sk-SK")}
            </strong>
            <KpiPeriodCompare
              current={kpis.orders}
              previous={prev?.orders}
              formatValue={intFmt}
              periodLabel={compareLabel}
            />
          </div>
          <div className="kpi-card">
            <span className="kpi-card__label">AOV</span>
            <strong className="kpi-card__value">
              {kpis.aov == null ? "—" : formatMoney(kpis.aov, currency)}
            </strong>
            <KpiPeriodCompare
              current={kpis.aov}
              previous={prev?.aov}
              formatValue={moneyFmt}
              periodLabel={compareLabel}
            />
          </div>
          <div className="kpi-card">
            <span className="kpi-card__label">Ads spend</span>
            <strong className="kpi-card__value">
              {formatMoney(kpis.ads_spend, currency)}
            </strong>
            <KpiPeriodCompare
              current={kpis.ads_spend}
              previous={prev?.ads_spend}
              formatValue={moneyFmt}
              higherIsBetter={false}
              periodLabel={compareLabel}
            />
          </div>
          <div className="kpi-card">
            <span className="kpi-card__label">Fees</span>
            <strong className="kpi-card__value">
              {formatMoney(kpis.fees_spend, currency)}
            </strong>
            <KpiPeriodCompare
              current={kpis.fees_spend}
              previous={prev?.fees_spend}
              formatValue={moneyFmt}
              higherIsBetter={false}
              periodLabel={compareLabel}
            />
          </div>
          <div className="kpi-card">
            <span className="kpi-card__label">Total MKT</span>
            <strong className="kpi-card__value">
              {formatMoney(kpis.total_mkt_spend, currency)}
            </strong>
            <KpiPeriodCompare
              current={kpis.total_mkt_spend}
              previous={prev?.total_mkt_spend}
              formatValue={moneyFmt}
              higherIsBetter={false}
              periodLabel={compareLabel}
            />
          </div>
          <div className="kpi-card">
            <span className="kpi-card__label">MER</span>
            <strong className="kpi-card__value">{formatRatio(kpis.mer)}</strong>
            <KpiPeriodCompare
              current={kpis.mer}
              previous={prev?.mer}
              formatValue={ratioFmt}
              periodLabel={compareLabel}
            />
          </div>
          <div className="kpi-card">
            <span className="kpi-card__label">Ad ROAS</span>
            <strong className="kpi-card__value">
              {formatRatio(kpis.ad_roas)}
            </strong>
            <KpiPeriodCompare
              current={kpis.ad_roas}
              previous={prev?.ad_roas}
              formatValue={ratioFmt}
              periodLabel={compareLabel}
            />
          </div>
          <div className="kpi-card">
            <span className="kpi-card__label">mROAS</span>
            <strong className="kpi-card__value">
              {formatRatio(kpis.m_roas)}
            </strong>
            <KpiPeriodCompare
              current={kpis.m_roas}
              previous={prev?.m_roas}
              formatValue={ratioFmt}
              periodLabel={compareLabel}
            />
          </div>
        </div>

        {chartData ? (
          <section className="dashboard-card" style={{ marginTop: "1.25rem" }}>
            <h2 className="dashboard-card__title">
              Mesačný vývoj · {ROLLING_RANGE_LABELS[SERIES_RANGE]}
            </h2>
            <div style={{ height: 320 }}>
              <Chart type="bar" data={chartData} options={chartOptions} />
            </div>
          </section>
        ) : null}

        <section className="dashboard-card" style={{ marginTop: "1.25rem" }}>
          <h2 className="dashboard-card__title">
            Mesačná tabuľka · {ROLLING_RANGE_LABELS[SERIES_RANGE]}
          </h2>
          <div className="table-wrap">
            <table className="data-table data-table--compact">
              <thead>
                <tr>
                  <th>Mesiac</th>
                  <th>Revenue</th>
                  <th>Orders</th>
                  <th>AOV</th>
                  <th>Ads</th>
                  <th>Fees</th>
                  <th title="Správa PPC / agentúra">Fees agentúra</th>
                  <th>Total MKT</th>
                  <th>MER</th>
                  <th>Ad ROAS</th>
                  <th title="Revenue / (Ads + Fees agentúry)">mROAS</th>
                  <th>MoM Rev</th>
                  <th>YoY Rev</th>
                </tr>
              </thead>
              <tbody>
                {data.monthly.map((row) => (
                  <tr key={row.month}>
                    <td>{formatMonthLabelSk(`${row.month}-01`)}</td>
                    <td>{formatMoney(row.revenue, currency)}</td>
                    <td>{(row.orders ?? 0).toLocaleString("sk-SK")}</td>
                    <td>
                      {row.aov == null ? "—" : formatMoney(row.aov, currency)}
                    </td>
                    <td>{formatMoney(row.ads_spend, currency)}</td>
                    <td>{formatMoney(row.fees_spend, currency)}</td>
                    <td>
                      {formatMoney(row.agency_fees_spend ?? 0, currency)}
                    </td>
                    <td>{formatMoney(row.total_mkt_spend, currency)}</td>
                    <td>{formatRatio(row.mer)}</td>
                    <td>{formatRatio(row.ad_roas)}</td>
                    <td>{formatRatio(row.m_roas)}</td>
                    <td>
                      {row.mom_revenue_pct == null
                        ? "—"
                        : `${row.mom_revenue_pct > 0 ? "+" : ""}${row.mom_revenue_pct} %`}
                    </td>
                    <td>
                      {row.yoy_revenue_pct == null
                        ? "—"
                        : `${row.yoy_revenue_pct > 0 ? "+" : ""}${row.yoy_revenue_pct} %`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {data.feesBreakdown.length > 0 ? (
          <section className="dashboard-card" style={{ marginTop: "1.25rem" }}>
            <h2 className="dashboard-card__title">Fees breakdown (denník)</h2>
            <div className="table-wrap">
              <table className="data-table data-table--compact">
                <thead>
                  <tr>
                    <th>Dodávateľ</th>
                    <th>Suma</th>
                  </tr>
                </thead>
                <tbody>
                  {data.feesBreakdown.map((row) => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td>{formatMoney(row.amount_eur, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <p className="msg" style={{ marginTop: "1rem" }}>
            Fees z denníka zatiaľ nie sú v databáze — spusti{" "}
            <code>python3 etl/import_accounting_journal_csv.py</code> po migrácii
            076.
          </p>
        )}

        {data.unmappedExpenses.length > 0 ? (
          <section className="dashboard-card" style={{ marginTop: "1.25rem" }}>
            <h2 className="dashboard-card__title">
              Nemapované náklady (na overenie s klientom)
            </h2>
            <div className="table-wrap">
              <table className="data-table data-table--compact">
                <thead>
                  <tr>
                    <th>Dodávateľ</th>
                    <th>Text</th>
                    <th>Účet</th>
                    <th>Suma</th>
                  </tr>
                </thead>
                <tbody>
                  {data.unmappedExpenses.map((row, i) => (
                    <tr key={`${row.label}-${i}`}>
                      <td>{row.label}</td>
                      <td>{row.line_text}</td>
                      <td>{row.debit_account}</td>
                      <td>{formatMoney(row.amount_eur, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
