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
import { MerKpiTargetCard } from "../components/MerKpiTargetCard";
import type { MerScorecardTargets } from "@/lib/marketingMerTargets";
import type { MerScorecardMode } from "@/lib/marketingMerScorecard";
import {
  buildMarketingMerMarkdown,
  downloadMarketingMarkdown,
} from "@/lib/marketingMarkdownExport";

ChartJS.register(...registerables);

/** Graf + tabuľka od 1. 1. 2026; scorecards = vybraný mesiac (default ukončený). */
const SERIES_RANGE = "365d" as const;
const SERIES_LABEL = "Od 1. 1. 2026";

const SCORECARD_MODE_OPTIONS: {
  key: MerScorecardMode;
  label: string;
}[] = [
  { key: "completed", label: "Ukončený mesiac" },
  { key: "mtd", label: "Prebiehajúci mesiac" },
];

type MerSpendFields = {
  meta_spend?: number;
  google_spend?: number;
  total_media_spend?: number;
  meta_agency_fee?: number;
  google_agency_fee?: number;
  agency_fees?: number;
  other_fees?: number;
  ads_spend: number;
  fees_spend: number;
  agency_fees_spend?: number;
  total_mkt_spend: number;
  blended_pno_pct?: number | null;
  media_roas?: number | null;
  mer: number | null;
  ad_roas?: number | null;
  m_roas?: number | null;
};

type MerKpis = MerSpendFields & {
  revenue: number;
  orders: number;
  aov: number | null;
  currency: string;
};

type MerMonthRow = MerSpendFields & {
  month: string;
  revenue: number;
  orders: number;
  aov: number | null;
  mom_revenue_pct: number | null;
  yoy_revenue_pct: number | null;
};

function merMediaSpend(row: MerSpendFields): number {
  return row.total_media_spend ?? row.ads_spend ?? 0;
}

function merMetaAgencyFee(row: MerSpendFields): number {
  if (row.meta_agency_fee != null) return row.meta_agency_fee;
  const total = row.agency_fees ?? row.agency_fees_spend;
  if (total != null && row.google_agency_fee == null) return total;
  return 0;
}

function merGoogleAgencyFee(row: MerSpendFields): number {
  return row.google_agency_fee ?? 0;
}

function merAgencyFees(row: MerSpendFields): number {
  if (row.meta_agency_fee != null || row.google_agency_fee != null) {
    return merMetaAgencyFee(row) + merGoogleAgencyFee(row);
  }
  return row.agency_fees ?? row.agency_fees_spend ?? 0;
}

function merOtherFees(row: MerSpendFields): number {
  if (row.other_fees != null) return row.other_fees;
  return Math.max(0, (row.fees_spend ?? 0) - merAgencyFees(row));
}

function merMetaSpend(row: MerSpendFields): number {
  return row.meta_spend ?? 0;
}

function merGoogleSpend(row: MerSpendFields): number {
  return row.google_spend ?? 0;
}

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
  scorecard?: {
    month: string;
    mode: MerScorecardMode;
    isMtd: boolean;
    kpis: MerKpis;
    kpisPrevious?: MerKpis | null;
    targets: MerScorecardTargets;
    meta?: MerPayload["meta"];
  };
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

type ExpenseSortKey =
  | "entry_date"
  | "supplier"
  | "line_text"
  | "doc_number"
  | "debit_account"
  | "role"
  | "amount_eur";

type ExpenseSortDir = "asc" | "desc";

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
  if (role === "meta_agency") return "Agentúra Meta";
  if (role === "google_agency") return "Agentúra Google";
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
  const [expenseSortKey, setExpenseSortKey] =
    useState<ExpenseSortKey>("entry_date");
  const [expenseSortDir, setExpenseSortDir] = useState<ExpenseSortDir>("desc");
  const [scorecardMode, setScorecardMode] =
    useState<MerScorecardMode>("completed");
  const pdfExportRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const q = `?range=${SERIES_RANGE}&scorecardMode=${scorecardMode}&_=${Date.now()}`;
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
  }, [scorecardMode]);

  useEffect(() => {
    void load();
  }, [load]);

  const currency = data?.scorecard?.kpis?.currency ?? data?.kpis.currency ?? "EUR";
  const kpis = data?.scorecard?.kpis ?? data?.kpisMom ?? data?.kpis ?? null;
  const prev = data?.scorecard?.kpisPrevious ?? data?.kpisPrevious ?? null;
  const scorecardTargets = data?.scorecard?.targets ?? null;
  const scorecardIsMtd = data?.scorecard?.isMtd ?? false;
  const scorecardMonthLabel = useMemo(() => {
    const ym = data?.scorecard?.month;
    if (ym && /^\d{4}-\d{2}$/.test(ym)) {
      return formatMonthLabelSk(ym);
    }
    const from = data?.meta.momFrom?.slice(0, 7);
    if (from && /^\d{4}-\d{2}$/.test(from)) {
      return formatMonthLabelSk(from);
    }
    return formatMonthLabelSk(currentCalendarYm());
  }, [data?.scorecard?.month, data?.meta.momFrom]);
  const compareLabel = useMemo(() => {
    const meta = data?.scorecard?.meta ?? data?.meta;
    if (!meta?.compareFrom || !meta?.compareTo) {
      return meta?.compareLabel ?? meta?.compareKind ?? "MoM";
    }
    const detail = previousPeriodLabel(meta.compareFrom, meta.compareTo);
    return `MoM · ${detail}`;
  }, [data]);

  const blendedPno = useMemo(() => {
    if (!kpis) return null;
    if (kpis.blended_pno_pct != null) return kpis.blended_pno_pct;
    if (kpis.revenue > 0) {
      return (kpis.total_mkt_spend / kpis.revenue) * 100;
    }
    return null;
  }, [kpis]);

  const prevBlendedPno = useMemo(() => {
    if (!prev) return null;
    if (prev.blended_pno_pct != null) return prev.blended_pno_pct;
    if (prev.revenue > 0) {
      return (prev.total_mkt_spend / prev.revenue) * 100;
    }
    return null;
  }, [prev]);

  const moneyFmt = useCallback(
    (v: number) => formatMoney(v, currency),
    [currency]
  );
  const ratioFmt = useCallback((v: number) => formatRatio(v), []);
  const intFmt = useCallback((v: number) => String(Math.round(v)), []);
  const pctFmt = useCallback((v: number) => formatPctOfMedia(v), []);

  const feePctMedia = useMemo(
    () =>
      kpis
        ? feePctOfMedia(merMediaSpend(kpis), merAgencyFees(kpis))
        : null,
    [kpis]
  );
  const feePctMediaPrev = useMemo(
    () =>
      prev ? feePctOfMedia(merMediaSpend(prev), merAgencyFees(prev)) : null,
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

  const chartData = useMemo(() => {
    if (!data?.monthly.length) return null;
    return {
      labels: data.monthly.map((r) => formatMonthLabelSk(`${r.month}-01`)),
      datasets: [
        {
          type: "bar" as const,
          label: "Meta spend",
          data: data.monthly.map((r) => merMetaSpend(r)),
          backgroundColor: "rgba(91, 141, 239, 0.92)",
          stack: "mkt",
          yAxisID: "y",
          order: 2,
        },
        {
          type: "bar" as const,
          label: "Google spend",
          data: data.monthly.map((r) => merGoogleSpend(r)),
          backgroundColor: "rgba(52, 168, 83, 0.9)",
          stack: "mkt",
          yAxisID: "y",
          order: 2,
        },
        {
          type: "bar" as const,
          label: "Meta agency fee",
          data: data.monthly.map((r) => merMetaAgencyFee(r)),
          backgroundColor: "rgba(155, 89, 182, 0.88)",
          stack: "mkt",
          yAxisID: "y",
          order: 2,
        },
        {
          type: "bar" as const,
          label: "Google agency fee",
          data: data.monthly.map((r) => merGoogleAgencyFee(r)),
          backgroundColor: "rgba(142, 68, 173, 0.55)",
          stack: "mkt",
          yAxisID: "y",
          order: 2,
        },
        {
          type: "line" as const,
          label: "Revenue",
          data: data.monthly.map((r) => r.revenue),
          borderColor: "rgba(245, 197, 24, 1)",
          backgroundColor: "rgba(245, 197, 24, 0.15)",
          borderWidth: 3,
          pointRadius: 4,
          pointBackgroundColor: "#fff",
          pointBorderColor: "rgba(245, 197, 24, 1)",
          pointBorderWidth: 2,
          yAxisID: "y",
          tension: 0.2,
          order: 1,
        },
        {
          type: "line" as const,
          label: "MER",
          data: data.monthly.map((r) => r.mer),
          borderColor: "rgba(26, 31, 40, 0.85)",
          backgroundColor: "transparent",
          borderWidth: 2,
          borderDash: [6, 4],
          pointRadius: 3,
          yAxisID: "y1",
          tension: 0.2,
          order: 1,
          spanGaps: true,
        },
      ],
    };
  }, [data]);

  const chartOptions = useMemo<ChartOptions<"bar">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#1a1f28", font: { family: "DM Sans, sans-serif" } },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y;
              if (v == null) return `${ctx.dataset.label}: —`;
              if (ctx.dataset.label === "MER") {
                return `MER: ${Number(v).toFixed(2)}×`;
              }
              return `${ctx.dataset.label}: ${formatMoney(Number(v), "EUR")}`;
            },
          },
        },
      },
      scales: {
        y: {
          stacked: true,
          position: "left",
          title: { display: true, text: "€", color: "#1a1f28" },
          ticks: { color: "#1a1f28" },
          grid: { color: "rgba(26,31,40,0.08)" },
        },
        y1: {
          position: "right",
          title: { display: true, text: "MER ×", color: "#1a1f28" },
          ticks: { color: "#1a1f28" },
          grid: { drawOnChartArea: false },
        },
        x: {
          stacked: true,
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

  const sortedExpenseLines = useMemo(() => {
    const copy = [...filteredExpenseLines];
    const dir = expenseSortDir === "asc" ? 1 : -1;
    copy.sort((a, b) => {
      if (expenseSortKey === "amount_eur") {
        return (Number(a.amount_eur) - Number(b.amount_eur)) * dir;
      }
      let av: string;
      let bv: string;
      if (expenseSortKey === "role") {
        av = expenseRoleLabel(a.role);
        bv = expenseRoleLabel(b.role);
      } else {
        av = String(a[expenseSortKey] ?? "");
        bv = String(b[expenseSortKey] ?? "");
      }
      return av.localeCompare(bv, "sk", { sensitivity: "base" }) * dir;
    });
    return copy;
  }, [filteredExpenseLines, expenseSortKey, expenseSortDir]);

  const filteredExpenseSum = useMemo(
    () =>
      sortedExpenseLines.reduce(
        (sum, row) => sum + Number(row.amount_eur || 0),
        0
      ),
    [sortedExpenseLines]
  );

  const toggleExpenseSort = (key: ExpenseSortKey) => {
    const textAscDefault =
      key === "supplier" ||
      key === "line_text" ||
      key === "doc_number" ||
      key === "debit_account" ||
      key === "role";
    if (expenseSortKey === key) {
      setExpenseSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setExpenseSortKey(key);
      setExpenseSortDir(
        key === "amount_eur" || key === "entry_date"
          ? "desc"
          : textAscDefault
            ? "asc"
            : "desc"
      );
    }
  };

  const expenseSortIndicator = (key: ExpenseSortKey) => {
    if (expenseSortKey !== key) return null;
    return expenseSortDir === "asc" ? " ▲" : " ▼";
  };

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

      <div
        className="scaling-window marketing-scorecard-window"
        role="group"
        aria-label="Obdobie scorecards"
        style={{ marginBottom: "1rem" }}
      >
        <div className="scaling-window__segmented marketing-scorecard-window__segmented">
          {SCORECARD_MODE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`scaling-window__btn${
                scorecardMode === opt.key ? " is-active" : ""
              }`}
              aria-pressed={scorecardMode === opt.key}
              onClick={() => setScorecardMode(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="dashboard-pdf-root" ref={pdfExportRef}>
        <h1 className="dashboard-card__title" style={{ marginBottom: "0.5rem" }}>
          MER — CEO marketing dashboard
        </h1>
        <p className="dashboard-meta">
          Scorecards: {scorecardMonthLabel}
          {scorecardIsMtd ? (
            <span className="mer-mtd-badge mer-mtd-badge--inline">
              Priebežné dáta (MTD)
            </span>
          ) : null}
          {" · "}
          Graf a tabuľka: {SERIES_LABEL}
        </p>
        <p className="dashboard-meta dashboard-meta--hint">
          Media = Meta CSV + Google (denník) · Agency = správa PPC · Other =
          kreatíva a nástroje · Total MKT = media + agency + other · Blended
          PNO = Total MKT / Revenue · Meta FP v denníku = skip.
        </p>

        <div className="kpi-grid kpi-grid--marketing-mer">
          <MerKpiTargetCard
            label="Revenue"
            display="goal"
            value={kpis.revenue}
            target={scorecardTargets?.revenue ?? null}
            formatValue={moneyFmt}
            formatTarget={moneyFmt}
            current={kpis.revenue}
            previous={prev?.revenue}
            compareFormatValue={moneyFmt}
            periodLabel={compareLabel}
            showMtdBadge={scorecardIsMtd}
          />
          <div className="kpi-card">
            <div className="kpi-card__label-row">
              <span className="kpi-card__label">Meta spend</span>
              {scorecardIsMtd ? (
                <span className="mer-mtd-badge">MTD</span>
              ) : null}
            </div>
            <strong className="kpi-card__value">
              {formatMoney(merMetaSpend(kpis), currency)}
            </strong>
            <KpiPeriodCompare
              current={merMetaSpend(kpis)}
              previous={prev ? merMetaSpend(prev) : undefined}
              formatValue={moneyFmt}
              higherIsBetter={false}
              periodLabel={compareLabel}
            />
          </div>
          <div className="kpi-card">
            <div className="kpi-card__label-row">
              <span className="kpi-card__label">Google spend</span>
              {scorecardIsMtd ? (
                <span className="mer-mtd-badge">MTD</span>
              ) : null}
            </div>
            <strong className="kpi-card__value">
              {formatMoney(merGoogleSpend(kpis), currency)}
            </strong>
            <KpiPeriodCompare
              current={merGoogleSpend(kpis)}
              previous={prev ? merGoogleSpend(prev) : undefined}
              formatValue={moneyFmt}
              higherIsBetter={false}
              periodLabel={compareLabel}
            />
          </div>
          <MerKpiTargetCard
            label="Total media"
            display="limit"
            value={merMediaSpend(kpis)}
            target={scorecardTargets?.total_media_spend ?? null}
            formatValue={moneyFmt}
            formatTarget={moneyFmt}
            current={merMediaSpend(kpis)}
            previous={prev ? merMediaSpend(prev) : undefined}
            compareFormatValue={moneyFmt}
            higherIsBetterCompare={false}
            periodLabel={compareLabel}
            showMtdBadge={scorecardIsMtd}
          />
          <MerKpiTargetCard
            label="Agency fees"
            display="limit"
            value={merAgencyFees(kpis)}
            target={scorecardTargets?.agency_fees ?? null}
            formatValue={moneyFmt}
            formatTarget={moneyFmt}
            current={merAgencyFees(kpis)}
            previous={prev ? merAgencyFees(prev) : undefined}
            compareFormatValue={moneyFmt}
            higherIsBetterCompare={false}
            periodLabel={compareLabel}
            showMtdBadge={scorecardIsMtd}
          />
          <div className="kpi-card">
            <div className="kpi-card__label-row">
              <span className="kpi-card__label">Other fees</span>
              {scorecardIsMtd ? (
                <span className="mer-mtd-badge">MTD</span>
              ) : null}
            </div>
            <strong className="kpi-card__value">
              {formatMoney(merOtherFees(kpis), currency)}
            </strong>
            <KpiPeriodCompare
              current={merOtherFees(kpis)}
              previous={prev ? merOtherFees(prev) : undefined}
              formatValue={moneyFmt}
              higherIsBetter={false}
              periodLabel={compareLabel}
            />
          </div>
          <MerKpiTargetCard
            label="Total MKT"
            display="limit"
            value={kpis.total_mkt_spend}
            target={scorecardTargets?.total_mkt_spend ?? null}
            formatValue={moneyFmt}
            formatTarget={moneyFmt}
            current={kpis.total_mkt_spend}
            previous={prev?.total_mkt_spend}
            compareFormatValue={moneyFmt}
            higherIsBetterCompare={false}
            periodLabel={compareLabel}
            showMtdBadge={scorecardIsMtd}
          />
          <MerKpiTargetCard
            label="Blended PNO"
            display="limit"
            value={blendedPno}
            target={scorecardTargets?.blended_pno_pct ?? null}
            formatValue={pctFmt}
            formatTarget={pctFmt}
            current={blendedPno ?? undefined}
            previous={prevBlendedPno ?? undefined}
            compareFormatValue={pctFmt}
            higherIsBetterCompare={false}
            periodLabel={compareLabel}
            showMtdBadge={scorecardIsMtd}
          />
          <MerKpiTargetCard
            label="Media ROAS"
            display="goal"
            value={kpis.media_roas ?? kpis.ad_roas ?? null}
            target={scorecardTargets?.media_roas ?? null}
            formatValue={ratioFmt}
            formatTarget={ratioFmt}
            current={kpis.media_roas ?? kpis.ad_roas ?? undefined}
            previous={prev?.media_roas ?? prev?.ad_roas ?? undefined}
            compareFormatValue={ratioFmt}
            periodLabel={compareLabel}
            showMtdBadge={scorecardIsMtd}
          />
          <MerKpiTargetCard
            label="MER"
            display="goal"
            value={kpis.mer}
            target={scorecardTargets?.mer ?? null}
            formatValue={ratioFmt}
            formatTarget={ratioFmt}
            current={kpis.mer ?? undefined}
            previous={prev?.mer ?? undefined}
            compareFormatValue={ratioFmt}
            periodLabel={compareLabel}
            showMtdBadge={scorecardIsMtd}
          />
          <div className="kpi-card">
            <div className="kpi-card__label-row">
              <span className="kpi-card__label">Fee % of media</span>
              {scorecardIsMtd ? (
                <span className="mer-mtd-badge">MTD</span>
              ) : null}
            </div>
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
              agency / media · bench. 10–20 %
            </span>
            <KpiPeriodCompare
              current={feePctMedia}
              previous={feePctMediaPrev}
              formatValue={pctFmt}
              higherIsBetter={false}
              periodLabel={compareLabel}
            />
          </div>
        </div>

        {chartData ? (
          <section className="dashboard-card" style={{ marginTop: "1.25rem" }}>
            <h2 className="dashboard-card__title">
              Mesačný vývoj · {SERIES_LABEL}
            </h2>
            <p className="dashboard-meta dashboard-meta--hint">
              Skladaný stĺpec = Meta spend · Google spend · Meta agency · Google
              agency · čiary = Revenue (€) a MER (×)
            </p>
            <div style={{ height: 360 }}>
              <Chart
                type="bar"
                data={chartData as ChartData<"bar">}
                options={chartOptions}
              />
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
                  <th>Meta spend</th>
                  <th>Google spend</th>
                  <th>Total media</th>
                  <th>Meta agency</th>
                  <th>Google agency</th>
                  <th>Other fees</th>
                  <th>Total MKT</th>
                  <th>Blended PNO</th>
                  <th>MER</th>
                </tr>
              </thead>
              <tbody>
                {data.monthly.map((row) => (
                  <tr key={row.month}>
                    <td>{formatMonthLabelSk(`${row.month}-01`)}</td>
                    <td>{formatMoney(row.revenue, currency)}</td>
                    <td>{formatMoney(merMetaSpend(row), currency)}</td>
                    <td>{formatMoney(merGoogleSpend(row), currency)}</td>
                    <td>{formatMoney(merMediaSpend(row), currency)}</td>
                    <td>{formatMoney(merMetaAgencyFee(row), currency)}</td>
                    <td>{formatMoney(merGoogleAgencyFee(row), currency)}</td>
                    <td>{formatMoney(merOtherFees(row), currency)}</td>
                    <td>{formatMoney(row.total_mkt_spend, currency)}</td>
                    <td>
                      {formatPctOfMedia(
                        row.blended_pno_pct ??
                          (row.revenue > 0
                            ? (row.total_mkt_spend / row.revenue) * 100
                            : null)
                      )}
                    </td>
                    <td>{formatRatio(row.mer)}</td>
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
                <option value="meta_agency">Agentúra Meta</option>
                <option value="google_agency">Agentúra Google</option>
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
            <table className="data-table data-table--compact data-table--sortable">
              <thead>
                <tr>
                  <th>
                    <button
                      type="button"
                      className="data-table__sort-btn"
                      onClick={() => toggleExpenseSort("entry_date")}
                    >
                      Dátum{expenseSortIndicator("entry_date")}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="data-table__sort-btn"
                      onClick={() => toggleExpenseSort("supplier")}
                    >
                      Dodávateľ{expenseSortIndicator("supplier")}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="data-table__sort-btn"
                      onClick={() => toggleExpenseSort("line_text")}
                    >
                      Text{expenseSortIndicator("line_text")}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="data-table__sort-btn"
                      onClick={() => toggleExpenseSort("doc_number")}
                    >
                      Doklad{expenseSortIndicator("doc_number")}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="data-table__sort-btn"
                      onClick={() => toggleExpenseSort("debit_account")}
                    >
                      Účet{expenseSortIndicator("debit_account")}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="data-table__sort-btn"
                      onClick={() => toggleExpenseSort("role")}
                    >
                      Zaradenie{expenseSortIndicator("role")}
                    </button>
                  </th>
                  <th className="num">
                    <button
                      type="button"
                      className="data-table__sort-btn data-table__sort-btn--num"
                      onClick={() => toggleExpenseSort("amount_eur")}
                    >
                      Suma{expenseSortIndicator("amount_eur")}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedExpenseLines.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="msg">
                      {expenseLines.length === 0
                        ? "Žiadne riadky — skontroluj import denníka alebo migráciu expense lines."
                        : "Žiadny riadok nevyhovuje filtrom."}
                    </td>
                  </tr>
                ) : (
                  sortedExpenseLines.map((row) => (
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
