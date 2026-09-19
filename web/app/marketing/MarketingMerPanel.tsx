"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chart as ChartJS, registerables } from "chart.js";
import type { ChartData, ChartOptions } from "chart.js";
import { Chart } from "react-chartjs-2";
import {
  currentCalendarYm,
  formatMonthLabelSk,
} from "@/lib/dashboardPeriodFilter";
import { previousPeriodLabel } from "@/lib/dashboardPeriodCompare";
import { KpiPeriodCompare } from "../components/KpiPeriodCompare";
import {
  buildMarketingMerMarkdown,
  downloadMarketingMarkdown,
} from "@/lib/marketingMarkdownExport";

ChartJS.register(...registerables);

/** Graf + tabuľka od 1. 1. 2026; scorecards vždy aktuálny mesiac (kpisMom). */
const SERIES_RANGE = "365d" as const;
const SERIES_LABEL = "Od 1. 1. 2026";

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
  feesBreakdown: { month?: string; label: string; amount_eur: number }[];
  marketingSuppliers?: {
    label: string;
    bucket: string;
    role: "fees" | "agency" | "ads_skip" | string;
    amount_eur: number;
    line_count: number;
    first_date: string;
    last_date: string;
  }[];
  unmappedExpenses: {
    label: string;
    line_text: string;
    debit_account: string;
    amount_eur: number;
  }[];
  marketingExpenseLines?: MarketingExpenseLine[];
};

type MarketingExpenseLine = {
  line_hash: string;
  entry_date: string;
  doc_number: string;
  supplier: string;
  line_text: string;
  debit_account: string;
  amount_eur: number;
  bucket: string | null;
  role: "fees" | "agency" | "ads_skip" | "unmapped" | string;
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

/** Agency fee as % of Meta ads spend. Benchmark typically 10–20 %. */
function feePctOfMedia(
  adsSpend: number | null | undefined,
  agencyFees: number | null | undefined
): number | null {
  const ads = adsSpend ?? 0;
  if (ads <= 0) return null;
  return ((agencyFees ?? 0) / ads) * 100;
}

function formatPctOfMedia(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toFixed(1)} %`;
}

function feePctBenchColor(pct: number | null): string | undefined {
  if (pct == null) return undefined;
  if (pct >= 10 && pct <= 20) return "var(--clr-green, #16a34a)";
  if (pct > 20 && pct <= 30) return "var(--clr-amber, #ca8a04)";
  return "var(--clr-red, #dc2626)";
}

function expenseRoleLabel(role: string): string {
  if (role === "agency") return "Agentúra (PPC)";
  if (role === "google_ads") return "Google Ads";
  if (role === "ads_skip") return "Meta FP (skip)";
  if (role === "unmapped") return "Nemapované";
  return "Fees";
}

function expenseRoleClass(role: string): string {
  return `marketing-expense-role marketing-expense-role--${role.replace(/[^a-z0-9_]/g, "_")}`;
}

function formatIsoDateSk(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${Number(d)}. ${Number(m)}. ${y}`;
}

export default function MarketingMerPanel() {
  const [data, setData] = useState<MerPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [expenseSupplierFilter, setExpenseSupplierFilter] = useState("");
  const [expenseRoleFilter, setExpenseRoleFilter] = useState("");
  const [expenseTextFilter, setExpenseTextFilter] = useState("");
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
  const pctFmt = useCallback((v: number) => formatPctOfMedia(v), []);

  const feePctMedia = useMemo(
    () => (kpis ? feePctOfMedia(kpis.ads_spend, kpis.agency_fees_spend) : null),
    [kpis]
  );
  const feePctMediaPrev = useMemo(
    () => (prev ? feePctOfMedia(prev.ads_spend, prev.agency_fees_spend) : null),
    [prev]
  );

  const downloadMd = useCallback(() => {
    if (!data || !kpis) return;
    const from = data.meta.from.replace(/\s/g, "");
    const to = data.meta.to.replace(/\s/g, "");
    const md = buildMarketingMerMarkdown({
      rangeLabel: `${scorecardMonthLabel} (scorecards) · ${SERIES_LABEL}`,
      from: data.meta.from,
      to: data.meta.to,
      launchFrom: data.meta.launch_from,
      currency: kpis.currency,
      kpis,
      monthly: data.monthly,
      feesBreakdown: data.feesBreakdown,
      marketingSuppliers: data.marketingSuppliers ?? [],
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

  const expenseLines = data?.marketingExpenseLines ?? [];

  const expenseSupplierOptions = useMemo(() => {
    const labels = new Set<string>();
    for (const row of expenseLines) labels.add(row.supplier);
    return Array.from(labels).sort((a, b) => a.localeCompare(b, "sk"));
  }, [expenseLines]);

  const filteredExpenseLines = useMemo(() => {
    const textNeedle = expenseTextFilter.trim().toLowerCase();
    return expenseLines.filter((row) => {
      if (expenseSupplierFilter && row.supplier !== expenseSupplierFilter) {
        return false;
      }
      if (expenseRoleFilter && row.role !== expenseRoleFilter) {
        return false;
      }
      if (textNeedle) {
        const hay = `${row.line_text} ${row.doc_number} ${row.debit_account}`.toLowerCase();
        if (!hay.includes(textNeedle)) return false;
      }
      return true;
    });
  }, [
    expenseLines,
    expenseSupplierFilter,
    expenseRoleFilter,
    expenseTextFilter,
  ]);

  const filteredExpenseSum = useMemo(
    () =>
      filteredExpenseLines.reduce(
        (sum, row) => sum + Number(row.amount_eur || 0),
        0
      ),
    [filteredExpenseLines]
  );

  const expenseFiltersActive =
    expenseSupplierFilter !== "" ||
    expenseRoleFilter !== "" ||
    expenseTextFilter.trim() !== "";

  const clearExpenseFilters = () => {
    setExpenseSupplierFilter("");
    setExpenseRoleFilter("");
    setExpenseTextFilter("");
  };

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
          Graf a tabuľka: {SERIES_LABEL}
        </p>
        <p className="dashboard-meta dashboard-meta--hint">
          Ads = Meta CSV + Google platforma (denník) · Fees = denník 518/5015 ·
          mROAS = Revenue / (Ads + Správa PPC) · VK Google agentúra vo Fees
          agentúra · Meta FP v denníku = skip (už v Meta CSV).
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
            <span className="kpi-card__label">Fee % of media</span>
            <strong
              className="kpi-card__value"
              style={{ color: feePctBenchColor(feePctMedia) }}
            >
              {formatPctOfMedia(feePctMedia)}
            </strong>
            <span
              className="kpi-card__hint"
              style={{
                display: "block",
                marginTop: "0.15rem",
                fontSize: "0.8rem",
                fontWeight: 500,
                color: feePctBenchColor(feePctMedia) ?? "inherit",
                opacity: 0.9,
              }}
            >
              benchmark 10–20 %
            </span>
            <KpiPeriodCompare
              current={feePctMedia}
              previous={feePctMediaPrev}
              formatValue={pctFmt}
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
              Mesačný vývoj · {SERIES_LABEL}
            </h2>
            <div style={{ height: 320 }}>
              <Chart type="bar" data={chartData} options={chartOptions} />
            </div>
          </section>
        ) : null}

        <section className="dashboard-card" style={{ marginTop: "1.25rem" }}>
          <h2 className="dashboard-card__title">
            Mesačná tabuľka · {SERIES_LABEL}
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
                  <th title="Agentúra fees / Ads spend">
                    Fee % media
                    <div style={{ fontWeight: 400, fontSize: "0.7rem", opacity: 0.75 }}>
                      bench. 10–20 %
                    </div>
                  </th>
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
                    <td
                      style={{
                        color: feePctBenchColor(
                          feePctOfMedia(row.ads_spend, row.agency_fees_spend)
                        ),
                        fontWeight: 600,
                      }}
                    >
                      {formatPctOfMedia(
                        feePctOfMedia(row.ads_spend, row.agency_fees_spend)
                      )}
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

        <section
          className="dashboard-card marketing-expense-table"
          style={{ marginTop: "1.25rem" }}
        >
          <div className="marketing-expense-table__head">
            <div>
              <h2 className="dashboard-card__title">
                Marketingové náklady (denník) · {SERIES_LABEL}
              </h2>
              <p className="dashboard-meta dashboard-meta--hint">
                Jednotlivé riadky z účtovného denníka · zobrazených{" "}
                {filteredExpenseLines.length} z {expenseLines.length}
                {filteredExpenseLines.length > 0
                  ? ` · súčet ${formatMoney(filteredExpenseSum, currency)}`
                  : ""}
              </p>
            </div>
          </div>
          <div className="marketing-expense-filters" role="search">
            <div className="period-filter marketing-expense-filters__field">
              <label
                className="period-filter__label"
                htmlFor="marketing-expense-supplier"
              >
                Dodávateľ
              </label>
              <select
                id="marketing-expense-supplier"
                className="period-filter__select"
                value={expenseSupplierFilter}
                onChange={(e) => setExpenseSupplierFilter(e.target.value)}
              >
                <option value="">Všetci</option>
                {expenseSupplierOptions.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="period-filter marketing-expense-filters__field marketing-expense-filters__field--grow">
              <label
                className="period-filter__label"
                htmlFor="marketing-expense-text"
              >
                Text
              </label>
              <input
                id="marketing-expense-text"
                type="search"
                className="period-filter__select marketing-expense-filters__search"
                placeholder="Doklad, popis, účet…"
                value={expenseTextFilter}
                onChange={(e) => setExpenseTextFilter(e.target.value)}
              />
            </div>
            <div className="period-filter marketing-expense-filters__field">
              <label
                className="period-filter__label"
                htmlFor="marketing-expense-role"
              >
                Zaradenie
              </label>
              <select
                id="marketing-expense-role"
                className="period-filter__select"
                value={expenseRoleFilter}
                onChange={(e) => setExpenseRoleFilter(e.target.value)}
              >
                <option value="">Všetky</option>
                <option value="fees">Fees</option>
                <option value="agency">Agentúra (PPC)</option>
                <option value="google_ads">Google Ads</option>
                <option value="ads_skip">Meta FP (skip)</option>
                <option value="unmapped">Nemapované</option>
              </select>
            </div>
            {expenseFiltersActive ? (
              <button
                type="button"
                className="dashboard-export-btn marketing-expense-filters__clear"
                onClick={clearExpenseFilters}
              >
                Zrušiť filtre
              </button>
            ) : null}
          </div>
          <div className="table-wrap">
            <table className="data-table data-table--compact">
              <thead>
                <tr>
                  <th>Dátum</th>
                  <th>Dodávateľ</th>
                  <th>Text</th>
                  <th>Doklad</th>
                  <th>Účet</th>
                  <th>Zaradenie</th>
                  <th className="num">Suma</th>
                </tr>
              </thead>
              <tbody>
                {filteredExpenseLines.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="msg">
                      {expenseLines.length === 0
                        ? "Žiadne riadky — skontroluj import denníka alebo migráciu expense lines."
                        : "Žiadny riadok nevyhovuje filtrom."}
                    </td>
                  </tr>
                ) : (
                  filteredExpenseLines.map((row) => (
                    <tr key={row.line_hash}>
                      <td>{formatIsoDateSk(row.entry_date)}</td>
                      <td>{row.supplier}</td>
                      <td>{row.line_text}</td>
                      <td>{row.doc_number || "—"}</td>
                      <td>{row.debit_account}</td>
                      <td>
                        <span className={expenseRoleClass(row.role)}>
                          {expenseRoleLabel(row.role)}
                        </span>
                      </td>
                      <td className="num">
                        {formatMoney(row.amount_eur, currency)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
