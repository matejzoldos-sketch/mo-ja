"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chart as ChartJS, registerables } from "chart.js";
import type { ChartData, ChartOptions } from "chart.js";
import { Bar } from "react-chartjs-2";

ChartJS.register(...registerables);

type PnlMonth = {
  month_key: string;
  sales_goods: number;
  sales_services: number;
  other_revenue: number;
  total_revenue: number;
  cogs_journal: number;
  cogs_estimated: number;
  cogs: number;
  gross_profit: number;
  material: number;
  representation: number;
  services: number;
  taxes_fees: number;
  other_operating: number;
  financial: number;
  total_opex: number;
  marketing_spend: number;
  staff_spend: number;
  contribution_margin: number;
};

type TopExpense = {
  supplier: string;
  account_prefix: string;
  amount_eur: number;
  line_count: number;
  is_marketing: boolean;
  is_staff: boolean;
};

type PnlPayload = {
  meta: {
    year: string;
    from: string;
    to: string;
    note: string;
    last_actual_month?: number;
    last_month_key?: string;
  };
  totals: {
    total_revenue: number;
    cogs_journal: number;
    cogs_estimated: number;
    cogs: number;
    gross_profit: number;
    total_opex: number;
    contribution_margin: number;
    marketing_spend: number;
    staff_spend: number;
  };
  monthly: PnlMonth[];
  topExpenses: TopExpense[];
  topExpensesLastMonth?: TopExpense[];
};

type PnlXlsMonth = {
  month_key: string;
  revenue: number;
  costs: number;
  profit_month: number;
  profit_ytd: number;
  marketing: number;
  opex: number;
  other_operating: number;
  staff: number;
  margin_pct: number | null;
};

type PnlXlsPayload = {
  meta: {
    year: number | string;
    from: string;
    to: string;
    last_actual_month: number;
    last_month_key?: string;
    note: string;
  };
  totals: {
    revenue_ytd: number;
    costs_ytd: number;
    profit_ytd: number;
    marketing_ytd: number;
    opex_ytd: number;
    other_operating_ytd: number;
    staff_ytd: number;
  };
  monthly: PnlXlsMonth[];
  topExpenses?: TopExpense[];
  topExpensesLastMonth?: TopExpense[];
};

function transformXlsToPnlPayload(xls: PnlXlsPayload): PnlPayload {
  const lastActual = xls.meta.last_actual_month ?? 12;

  const actualMonths = xls.monthly.filter((m) => {
    const monthNum = parseInt(m.month_key.split("-")[1], 10);
    return monthNum <= lastActual;
  });

  const mapped: PnlMonth[] = actualMonths.map((m) => ({
    month_key: m.month_key,
    sales_goods: m.revenue,
    sales_services: 0,
    other_revenue: 0,
    total_revenue: m.revenue,
    cogs_journal: 0,
    cogs_estimated: 0,
    cogs: m.costs - m.opex,
    gross_profit: m.revenue - (m.costs - m.opex),
    material: 0,
    representation: 0,
    services: Math.max(0, m.opex - m.other_operating),
    taxes_fees: 0,
    other_operating: m.other_operating,
    financial: 0,
    total_opex: m.opex,
    marketing_spend: m.marketing,
    staff_spend: m.staff ?? 0,
    contribution_margin: m.profit_month,
  }));

  const sumRev = mapped.reduce((s, m) => s + m.total_revenue, 0);
  const sumCogs = mapped.reduce((s, m) => s + m.cogs, 0);
  const sumOpex = mapped.reduce((s, m) => s + m.total_opex, 0);
  const sumCm = mapped.reduce((s, m) => s + m.contribution_margin, 0);
  const sumMk = mapped.reduce((s, m) => s + m.marketing_spend, 0);

  return {
    meta: {
      year: String(xls.meta.year),
      from: xls.meta.from,
      to: xls.meta.to,
      note: `Hodnoty z XLS „Výsledky" (Jan–${monthLabel(actualMonths[actualMonths.length - 1]?.month_key ?? "01")} ${xls.meta.year}, skutočnosť podľa denníka).`,
      last_actual_month: lastActual,
      last_month_key: xls.meta.last_month_key ?? actualMonths[actualMonths.length - 1]?.month_key,
    },
    totals: {
      total_revenue: sumRev,
      cogs_journal: 0,
      cogs_estimated: 0,
      cogs: sumCogs,
      gross_profit: sumRev - sumCogs,
      total_opex: sumOpex,
      contribution_margin: sumCm,
      marketing_spend: sumMk,
      staff_spend: mapped.reduce((s, m) => s + (m.staff_spend ?? 0), 0),
    },
    monthly: mapped,
    topExpenses: xls.topExpenses ?? [],
    topExpensesLastMonth: xls.topExpensesLastMonth ?? [],
  };
}

const COGS_RATE = 0.356;

function transformHybridPayload(xls: PnlXlsPayload): PnlPayload {
  const lastActual = xls.meta.last_actual_month ?? 12;

  const actualMonths = xls.monthly.filter((m) => {
    const monthNum = parseInt(m.month_key.split("-")[1], 10);
    return monthNum <= lastActual;
  });

  const mapped: PnlMonth[] = actualMonths.map((m) => {
    const cogs = Math.round(m.revenue * COGS_RATE * 100) / 100;
    const grossProfit = m.revenue - cogs;
    const opex = m.opex;
    const cm = grossProfit - opex;
    return {
      month_key: m.month_key,
      sales_goods: m.revenue,
      sales_services: 0,
      other_revenue: 0,
      total_revenue: m.revenue,
      cogs_journal: 0,
      cogs_estimated: cogs,
      cogs,
      gross_profit: grossProfit,
      material: 0,
      representation: 0,
      services: Math.max(0, m.opex - m.other_operating),
      taxes_fees: 0,
      other_operating: m.other_operating,
      financial: 0,
      total_opex: opex,
      marketing_spend: m.marketing,
      staff_spend: m.staff ?? 0,
      contribution_margin: cm,
    };
  });

  const sumRev = mapped.reduce((s, m) => s + m.total_revenue, 0);
  const sumCogs = mapped.reduce((s, m) => s + m.cogs, 0);
  const sumOpex = mapped.reduce((s, m) => s + m.total_opex, 0);
  const sumCm = mapped.reduce((s, m) => s + m.contribution_margin, 0);
  const sumMk = mapped.reduce((s, m) => s + m.marketing_spend, 0);
  const sumStaff = mapped.reduce((s, m) => s + m.staff_spend, 0);

  return {
    meta: {
      year: String(xls.meta.year),
      from: xls.meta.from,
      to: xls.meta.to,
      note: `Hybrid: tržby a OPEX z XLS, COGS = ${(COGS_RATE * 100).toFixed(1)} % z tržieb za tovar (Shopify). Jan–${monthLabel(actualMonths[actualMonths.length - 1]?.month_key ?? "01")} ${xls.meta.year}.`,
      last_actual_month: lastActual,
      last_month_key: xls.meta.last_month_key ?? actualMonths[actualMonths.length - 1]?.month_key,
    },
    totals: {
      total_revenue: sumRev,
      cogs_journal: 0,
      cogs_estimated: sumCogs,
      cogs: sumCogs,
      gross_profit: sumRev - sumCogs,
      total_opex: sumOpex,
      contribution_margin: sumCm,
      marketing_spend: sumMk,
      staff_spend: sumStaff,
    },
    monthly: mapped,
    topExpenses: xls.topExpenses ?? [],
    topExpensesLastMonth: xls.topExpensesLastMonth ?? [],
  };
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat("sk-SK", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatPct(n: number): string {
  return new Intl.NumberFormat("sk-SK", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(n);
}

function monthLabel(ym: string): string {
  const [, m] = ym.split("-");
  const labels = [
    "Jan", "Feb", "Mar", "Apr", "Máj", "Jún",
    "Júl", "Aug", "Sep", "Okt", "Nov", "Dec",
  ];
  return labels[parseInt(m, 10) - 1] ?? m;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("sk-SK", { maximumFractionDigits: 0 }).format(n) + " €";
}

const ACCOUNT_LABELS: Record<string, string> = {
  "501": "Materiál",
  "504": "Náklady na tovar",
  "513": "Reprezentácia",
  "518": "Služby",
  "538": "Dane, poplatky",
  "548": "Ostatné prevádzkové",
  "563": "Kurzové straty",
  "568": "Bankové poplatky",
};

export default function PnlPanel() {
  const [data, setData] = useState<PnlPayload | null>(null);
  const [mode, setMode] = useState<"accounting" | "xls" | "hybrid">("hybrid");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfExporting, setPdfExporting] = useState(false);
  const pdfExportRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const apiMode = mode === "hybrid" ? "xls" : mode;
      const res = await fetch(`/api/pnl?mode=${apiMode}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const body = await res.json();
      if (mode === "hybrid") {
        setData(transformHybridPayload(body as PnlXlsPayload));
      } else if (mode === "xls") {
        setData(transformXlsToPnlPayload(body as PnlXlsPayload));
      } else {
        setData(body as PnlPayload);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => { load(); }, [load]);

  const buildMarkdown = useCallback((): string => {
    if (!data) return "";
    const { totals: t, monthly, topExpenses, meta } = data;
    const mPct = t.total_revenue ? ((t.contribution_margin / t.total_revenue) * 100).toFixed(1) : "–";
    const mkPct = t.total_revenue ? ((t.marketing_spend / t.total_revenue) * 100).toFixed(1) : "–";
    let md = `# ${
      mode === "xls" ? `P&L (XLS Výsledky) ${meta.year}` : mode === "hybrid" ? `P&L — Hybrid ${meta.year}` : `P&L — Contribution Margin ${meta.year}`
    }\n\n`;
    md += `> ${meta.note}\n\n`;
    md += `| KPI | Hodnota |\n|---|---|\n`;
    md += `| Tržby | ${fmt(t.total_revenue)} |\n`;
    md += `| COGS | ${fmt(t.cogs)} |\n`;
    md += `| Hrubá marža | ${fmt(t.gross_profit)} |\n`;
    md += `| OPEX | ${fmt(t.total_opex)} |\n`;
    md += `| **Contribution margin** | **${fmt(t.contribution_margin)} (${mPct} %)** |\n`;
    md += `| z toho marketing | ${fmt(t.marketing_spend)} (${mkPct} %) |\n\n`;
    md += `## Mesačný prehľad\n\n`;
    md += `| Mesiac | Tržby | COGS | Hrubá marža | OPEX | Marketing | CM | CM % |\n`;
    md += `|---|---|---|---|---|---|---|---|\n`;
    for (const m of monthly) {
      const cm = m.contribution_margin;
      const cmP = m.total_revenue ? ((cm / m.total_revenue) * 100).toFixed(1) : "–";
      md += `| ${monthLabel(m.month_key)} | ${fmt(m.total_revenue)} | ${fmt(m.cogs)} | ${fmt(m.gross_profit)} | ${fmt(m.total_opex)} | ${fmt(m.marketing_spend)} | ${fmt(cm)} | ${cmP} % |\n`;
    }
    md += `\n## Top dodávatelia\n\n`;
    md += `| Dodávateľ | Účet | Suma | Riadkov |\n|---|---|---|---|\n`;
    for (const e of topExpenses) {
      md += `| ${e.supplier} | ${ACCOUNT_LABELS[e.account_prefix] ?? e.account_prefix} | ${fmt(e.amount_eur)} | ${e.line_count} |\n`;
    }
    return md;
  }, [data, mode]);

  const downloadMd = useCallback(() => {
    const md = buildMarkdown();
    if (!md) return;
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pnl-${data!.meta.year}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [buildMarkdown, data]);

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
      pdf.save(`pnl-${data.meta.year}.pdf`);
    } catch (e) {
      console.error(e);
      window.alert(e instanceof Error ? e.message : "Export do PDF zlyhal.");
    } finally {
      setPdfExporting(false);
    }
  }, [data]);

  const chartData = useMemo((): ChartData<"bar"> | null => {
    if (!data) return null;
    const months = data.monthly;
    if (mode === "xls") {
      return {
        labels: months.map((m) => monthLabel(m.month_key)),
        datasets: [
          {
            label: "Výnosy",
            data: months.map((m) => m.total_revenue),
            backgroundColor: "rgba(34,197,94,0.7)",
            stack: "revenue",
          },
          {
            label: "Náklady",
            data: months.map((m) => -(m.cogs + m.total_opex)),
            backgroundColor: "rgba(239,68,68,0.5)",
            stack: "costs",
          },
          {
            label: "Zisk/strata",
            data: months.map((m) => m.contribution_margin),
            backgroundColor: months.map((m) =>
              m.contribution_margin >= 0
                ? "rgba(59,130,246,0.7)"
                : "rgba(239,68,68,0.7)"
            ),
            stack: "margin",
          },
        ],
      };
    }
    return {
      labels: months.map((m) => monthLabel(m.month_key)),
      datasets: [
        {
          label: "Tržby",
          data: months.map((m) => m.total_revenue),
          backgroundColor: "rgba(34,197,94,0.7)",
          stack: "revenue",
        },
        {
          label: "COGS",
          data: months.map((m) => -m.cogs),
          backgroundColor: "rgba(239,68,68,0.5)",
          stack: "costs",
        },
        {
          label: "OPEX",
          data: months.map((m) => -m.total_opex),
          backgroundColor: "rgba(249,115,22,0.5)",
          stack: "costs",
        },
        {
          label: "Contribution margin",
          data: months.map((m) => m.contribution_margin),
          backgroundColor: months.map((m) =>
            m.contribution_margin >= 0
              ? "rgba(59,130,246,0.7)"
              : "rgba(239,68,68,0.7)"
          ),
          stack: "margin",
        },
      ],
    };
  }, [data, mode]);

  const chartOpts = useMemo(
    (): ChartOptions<"bar"> => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${formatMoney(ctx.parsed.y ?? 0)}`,
          },
        },
      },
      scales: {
        x: { stacked: true },
        y: {
          stacked: false,
          ticks: {
            callback: (v) =>
              typeof v === "number"
                ? new Intl.NumberFormat("sk-SK", { notation: "compact" }).format(v) + " €"
                : v,
          },
        },
      },
    }),
    []
  );

  if (loading) return <p className="msg">Načítavam P&L…</p>;
  if (error) return <p className="msg msg--error">Chyba: {error}</p>;
  if (!data) return null;

  const { totals: t, monthly, topExpenses, meta } = data;
  const marginPct = t.total_revenue ? t.contribution_margin / t.total_revenue : 0;
  const revenue = t.total_revenue || 0;
  const cogsPct = revenue ? t.cogs / revenue : 0;
  const grossMarginPct = revenue ? t.gross_profit / revenue : 0;
  const opexPct = revenue ? t.total_opex / revenue : 0;
  const marketingPct = revenue ? t.marketing_spend / revenue : 0;
  const staffPct = revenue ? (t.staff_spend ?? 0) / revenue : 0;

  const inBench = (pctFraction: number, minPct: number, maxPct: number) =>
    pctFraction * 100 >= minPct && pctFraction * 100 <= maxPct;

  const cogsOk = inBench(cogsPct, 30, 55);
  const grossMarginOk = inBench(grossMarginPct, 45, 70);
  const opexOk = inBench(opexPct, 20, 50);
  const contributionMarginOk = inBench(marginPct, 10, 30);
  const marketingOk = inBench(marketingPct, 10, 30);
  const staffOk = inBench(staffPct, 15, 35);

  return (
    <section className="panel">
      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: "0.5rem",
        }}
      >
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span style={{ fontSize: "0.9rem", opacity: 0.85 }}>Zdroj</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "accounting" | "xls" | "hybrid")}
            style={{
              padding: "4px 8px",
              borderRadius: 8,
              border: "1px solid var(--border-strong)",
              font: "inherit",
              fontSize: "0.85rem",
            }}
            aria-label="Zdroj dát P&L"
          >
            <option value="hybrid">Hybrid (XLS + COGS Shopify)</option>
            <option value="accounting">Účtovníctvo (denník)</option>
            <option value="xls">XLS (Výsledky)</option>
          </select>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="btn btn--outline btn--sm"
            onClick={downloadMd}
          >
            Stiahnuť MD
          </button>
          <button
            type="button"
            className="btn btn--outline btn--sm"
            onClick={downloadPdf}
            disabled={pdfExporting}
          >
            {pdfExporting ? "Generujem PDF…" : "Stiahnuť PDF"}
          </button>
        </div>
      </div>

      <div className="dashboard-pdf-root" ref={pdfExportRef}>
      <h2 className="panel__title">
        {mode === "xls" ? `P&L (XLS Výsledky) ${meta.year}` : mode === "hybrid" ? `P&L — Hybrid ${meta.year}` : `P&L — Contribution Margin ${meta.year}`}
      </h2>
      <p className="panel__note">{meta.note}</p>

      {/* KPI scorecards */}
      {mode === "xls" ? (
        <div className="kpi-row" style={{ display: "flex", gap: "1rem", flexWrap: "wrap", margin: "1rem 0" }}>
          <KpiCard label="Výnosy (YTD)" value={formatMoney(t.total_revenue)} />
          <KpiCard
            label="Náklady (YTD)"
            value={formatMoney(t.cogs + t.total_opex)}
          />
          <KpiCard
            label="Zisk / strata (YTD)"
            value={formatMoney(t.contribution_margin)}
            highlight={t.contribution_margin >= 0 ? "positive" : "negative"}
          />
          <KpiCard
            label="Marža"
            value={revenue ? formatPct(marginPct) : "–"}
            highlight={t.contribution_margin >= 0 ? "positive" : "negative"}
          />
        </div>
      ) : (
        <div className="kpi-row" style={{ display: "flex", gap: "1rem", flexWrap: "wrap", margin: "1rem 0" }}>
          <KpiCard label="Tržby" value={formatMoney(t.total_revenue)} />
          <KpiCard
            label="COGS"
            value={formatMoney(t.cogs)}
            highlight={cogsOk ? "positive" : "negative"}
            sub={`${formatPct(cogsPct)} · benchmark 30–55 % · ${
              t.cogs_journal < t.cogs_estimated ? "odhad 35,6 % z tovaru" : "z denníka (504)"
            }`}
          />
          <KpiCard
            label="Hrubá marža"
            value={formatMoney(t.gross_profit)}
            highlight={grossMarginOk ? "positive" : "negative"}
            sub={`${formatPct(grossMarginPct)} · benchmark 45–70 %`}
          />
          <KpiCard
            label="OPEX"
            value={formatMoney(t.total_opex)}
            highlight={opexOk ? "positive" : "negative"}
            sub={`${formatPct(opexPct)} · benchmark 20–50 %`}
          />
          <KpiCard
            label="Contribution margin"
            value={formatMoney(t.contribution_margin)}
            sub={`${formatPct(marginPct)} · benchmark 10–30 %`}
            highlight={contributionMarginOk ? "positive" : "negative"}
          />
          <KpiCard
            label="z toho marketing"
            value={formatMoney(t.marketing_spend)}
            highlight={marketingOk ? "positive" : "negative"}
            sub={`${t.total_revenue ? formatPct(marketingPct) : "–"} z tržieb · benchmark 10–30 %`}
          />
          <KpiCard
            label="z toho staff"
            value={formatMoney(t.staff_spend ?? 0)}
            highlight={staffOk ? "positive" : "negative"}
            sub={`${t.total_revenue ? formatPct(staffPct) : "–"} z tržieb · benchmark 15–35 %`}
          />
        </div>
      )}

      {/* Chart */}
      {chartData && (
        <div style={{ height: 340, marginBottom: "1.5rem" }}>
          <Bar data={chartData} options={chartOpts} />
        </div>
      )}

      {/* Monthly table */}
      <div className="table-wrap" style={{ overflowX: "auto" }}>
        {mode === "xls" ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Mesiac</th>
                <th className="num">Výnosy</th>
                <th className="num">Náklady</th>
                <th className="num" style={{ fontWeight: 700 }}>Zisk / strata</th>
                <th className="num">Zisk YTD</th>
                <th className="num">Marža %</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((m) => {
                const profit = m.contribution_margin;
                const mPctRow = m.total_revenue ? profit / m.total_revenue : 0;
                let ytd = 0;
                for (const row of monthly) {
                  ytd += row.contribution_margin;
                  if (row.month_key === m.month_key) break;
                }
                return (
                  <tr key={m.month_key}>
                    <td>{monthLabel(m.month_key)}</td>
                    <td className="num">{formatMoney(m.total_revenue)}</td>
                    <td className="num">{formatMoney(m.cogs + m.total_opex)}</td>
                    <td
                      className="num"
                      style={{ fontWeight: 700, color: profit >= 0 ? "var(--clr-green, #16a34a)" : "var(--clr-red, #dc2626)" }}
                    >
                      {formatMoney(profit)}
                    </td>
                    <td
                      className="num"
                      style={{ color: ytd >= 0 ? "var(--clr-green, #16a34a)" : "var(--clr-red, #dc2626)" }}
                    >
                      {formatMoney(ytd)}
                    </td>
                    <td className="num">{formatPct(mPctRow)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700 }}>
                <td>YTD</td>
                <td className="num">{formatMoney(t.total_revenue)}</td>
                <td className="num">{formatMoney(t.cogs + t.total_opex)}</td>
                <td
                  className="num"
                  style={{ color: t.contribution_margin >= 0 ? "var(--clr-green, #16a34a)" : "var(--clr-red, #dc2626)" }}
                >
                  {formatMoney(t.contribution_margin)}
                </td>
                <td
                  className="num"
                  style={{ color: t.contribution_margin >= 0 ? "var(--clr-green, #16a34a)" : "var(--clr-red, #dc2626)" }}
                >
                  {formatMoney(t.contribution_margin)}
                </td>
                <td className="num">{formatPct(marginPct)}</td>
              </tr>
            </tfoot>
          </table>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Mesiac</th>
                <th className="num">Tržby tovar</th>
                <th className="num">Tržby služby</th>
                <th className="num">Spolu tržby</th>
                <th className="num" title="COGS = max(denník 504, odhad 35,6 % tržieb za tovar)">COGS*</th>
                <th className="num">Hrubá marža</th>
                <th className="num">Služby (518 bez mk, staff)</th>
                <th className="num">Staff</th>
                <th className="num">Marketing</th>
                <th className="num">Ostatné</th>
                <th className="num">OPEX spolu</th>
                <th className="num" style={{ fontWeight: 700 }}>CM</th>
                <th className="num">CM %</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((m) => {
                const cm = m.contribution_margin;
                const cmPct = m.total_revenue ? cm / m.total_revenue : 0;
                const other = m.material + m.representation + m.taxes_fees + m.other_operating + m.financial;
                const servicesClean = Math.max(0, m.services - m.marketing_spend - (m.staff_spend ?? 0));
                return (
                  <tr key={m.month_key}>
                    <td>{monthLabel(m.month_key)}</td>
                    <td className="num">{formatMoney(m.sales_goods)}</td>
                    <td className="num">{formatMoney(m.sales_services)}</td>
                    <td className="num">{formatMoney(m.total_revenue)}</td>
                    <td className="num">{formatMoney(m.cogs)}</td>
                    <td className="num">{formatMoney(m.gross_profit)}</td>
                    <td className="num">{formatMoney(servicesClean)}</td>
                    <td className="num">{formatMoney(m.staff_spend ?? 0)}</td>
                    <td className="num">{formatMoney(m.marketing_spend)}</td>
                    <td className="num">{formatMoney(other)}</td>
                    <td className="num">{formatMoney(m.total_opex)}</td>
                    <td
                      className="num"
                      style={{ fontWeight: 700, color: cm >= 0 ? "var(--clr-green, #16a34a)" : "var(--clr-red, #dc2626)" }}
                    >
                      {formatMoney(cm)}
                    </td>
                    <td className="num">{formatPct(cmPct)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700 }}>
                <td>YTD</td>
                <td className="num">{formatMoney(monthly.reduce((s, m) => s + m.sales_goods, 0))}</td>
                <td className="num">{formatMoney(monthly.reduce((s, m) => s + m.sales_services, 0))}</td>
                <td className="num">{formatMoney(t.total_revenue)}</td>
                <td className="num">{formatMoney(t.cogs)}</td>
                <td className="num">{formatMoney(t.gross_profit)}</td>
                <td className="num">
                  {formatMoney(
                    monthly.reduce((s, m) => s + Math.max(0, m.services - m.marketing_spend - (m.staff_spend ?? 0)), 0)
                  )}
                </td>
                <td className="num">{formatMoney(t.staff_spend ?? 0)}</td>
                <td className="num">{formatMoney(t.marketing_spend)}</td>
                <td className="num">
                  {formatMoney(
                    monthly.reduce(
                      (s, m) => s + m.material + m.representation + m.taxes_fees + m.other_operating + m.financial,
                      0
                    )
                  )}
                </td>
                <td className="num">{formatMoney(t.total_opex)}</td>
                <td
                  className="num"
                  style={{ color: t.contribution_margin >= 0 ? "var(--clr-green, #16a34a)" : "var(--clr-red, #dc2626)" }}
                >
                  {formatMoney(t.contribution_margin)}
                </td>
                <td className="num">{formatPct(marginPct)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {mode === "accounting" && (
        <p style={{ fontSize: "0.75rem", opacity: 0.6, marginTop: "0.5rem" }}>
          * COGS = vyššia z hodnôt: účet 504 z denníka vs. odhad 35,6 % tržieb za tovar (nákupná cena Orin).
          Odhad vychádza z produktovej kalkulácie (marža ~50 % vrátane fulfillmentu, platobnej brány a prepravy).
        </p>
      )}

      {/* Cost structure vs benchmark */}
      <CostStructureTable
        totals={t}
        monthly={monthly}
        lastMonthLabel={monthLabel(meta.last_month_key ?? monthly[monthly.length - 1]?.month_key ?? "01")}
      />

      {/* All expenses */}
      {topExpenses?.length ? (
        <SortableExpensesTable
          expenses={topExpenses}
          title={
            mode === "accounting"
              ? "Všetci dodávatelia (náklady)"
              : "Nákladové položky (z XLS)"
          }
          sourceNote={
            mode === "accounting"
              ? undefined
              : "Položky zo sheetu Výsledky (XLS). Filtruje podľa Staff / Marketing / prevádzka podľa sekcie v XLS."
          }
        />
      ) : null}
      </div>
    </section>
  );
}

type SortKey = "supplier" | "account_prefix" | "amount_eur" | "line_count" | "is_marketing";
type SortDir = "asc" | "desc";

function SortableExpensesTable({
  expenses,
  title = "Všetci dodávatelia (náklady)",
  sourceNote,
}: {
  expenses: TopExpense[];
  title?: string;
  sourceNote?: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("amount_eur");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [typeFilter, setTypeFilter] = useState<
    "all" | "marketing" | "staff" | "non_marketing"
  >("all");
  const [accountFilter, setAccountFilter] = useState<string>("all");

  const accountOptions = useMemo(() => {
    const s = new Set(expenses.map((e) => e.account_prefix));
    return Array.from(s).sort();
  }, [expenses]);

  const filtered = useMemo(() => {
    return expenses.filter((e) => {
      if (accountFilter !== "all" && e.account_prefix !== accountFilter) {
        return false;
      }
      if (typeFilter === "marketing" && !e.is_marketing) return false;
      if (typeFilter === "staff" && !e.is_staff) return false;
      if (typeFilter === "non_marketing" && (e.is_marketing || e.is_staff)) return false;
      return true;
    });
  }, [expenses, accountFilter, typeFilter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "boolean" && typeof bv === "boolean") {
        return sortDir === "asc" ? +av - +bv : +bv - +av;
      }
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const as = String(av).toLowerCase();
      const bs = String(bv).toLowerCase();
      return sortDir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as);
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const toggle = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "supplier" || key === "account_prefix" ? "asc" : "desc");
    }
  };

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const thStyle: React.CSSProperties = { cursor: "pointer", userSelect: "none" };

  return (
    <div style={{ marginTop: "2rem" }}>
      <h3>{title}</h3>
      {sourceNote ? (
        <p style={{ fontSize: "0.8rem", opacity: 0.7, marginTop: 0 }}>{sourceNote}</p>
      ) : null}
      <div className="table-wrap" style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={thStyle} onClick={() => toggle("supplier")}>
                Dodávateľ{arrow("supplier")}
              </th>
              <th style={thStyle} onClick={() => toggle("account_prefix")}>
                Účet{arrow("account_prefix")}
              </th>
              <th style={thStyle} onClick={() => toggle("is_marketing")}>
                Typ{arrow("is_marketing")}
              </th>
              <th className="num" style={thStyle} onClick={() => toggle("amount_eur")}>
                Suma{arrow("amount_eur")}
              </th>
              <th className="num" style={thStyle} onClick={() => toggle("line_count")}>
                Riadkov{arrow("line_count")}
              </th>
            </tr>
            <tr>
              <th />
              <th>
                <select
                  value={accountFilter}
                  onChange={(e) => setAccountFilter(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "4px 6px",
                    borderRadius: 6,
                    border: "1px solid var(--border-strong)",
                    font: "inherit",
                    fontSize: "0.8rem",
                  }}
                  aria-label="Filter účtu"
                >
                  <option value="all">Všetky účty</option>
                  {accountOptions.map((a) => (
                    <option key={a} value={a}>
                      {ACCOUNT_LABELS[a] ?? a} ({a})
                    </option>
                  ))}
                </select>
              </th>
              <th>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
                  style={{
                    width: "100%",
                    padding: "4px 6px",
                    borderRadius: 6,
                    border: "1px solid var(--border-strong)",
                    font: "inherit",
                    fontSize: "0.8rem",
                  }}
                  aria-label="Filter typu"
                >
                  <option value="all">Všetky typy</option>
                  <option value="marketing">marketing</option>
                  <option value="staff">staff</option>
                  <option value="non_marketing">prevádzka</option>
                </select>
              </th>
              <th />
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((e, i) => (
              <tr key={i} style={e.is_marketing ? { background: "rgba(234,179,8,0.08)" } : e.is_staff ? { background: "rgba(99,102,241,0.06)" } : undefined}>
                <td>{e.supplier}</td>
                <td>{ACCOUNT_LABELS[e.account_prefix] ?? e.account_prefix}</td>
                <td>
                  <span style={{
                    fontSize: "0.7rem",
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: e.is_marketing ? "rgba(234,179,8,0.2)" : e.is_staff ? "rgba(99,102,241,0.15)" : "rgba(100,116,139,0.1)",
                    color: e.is_marketing ? "#92400e" : e.is_staff ? "#4338ca" : "#475569",
                  }}>
                    {e.is_marketing ? "marketing" : e.is_staff ? "staff" : "prevádzka"}
                  </span>
                </td>
                <td className="num">{formatMoney(e.amount_eur)}</td>
                <td className="num">{e.line_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: "0.8rem", opacity: 0.65, marginTop: "0.5rem" }}>
        Vyfiltrované: {formatMoney(filtered.reduce((s, e) => s + e.amount_eur, 0))} · skupín:{" "}
        {filtered.length}
      </p>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  negative,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  negative?: boolean;
  highlight?: "positive" | "negative";
}) {
  let color: string | undefined;
  if (highlight === "positive") color = "var(--clr-green, #16a34a)";
  if (highlight === "negative" || negative) color = "var(--clr-red, #dc2626)";

  return (
    <div
      style={{
        background: "var(--clr-surface, #f8fafc)",
        borderRadius: 8,
        padding: "0.75rem 1rem",
        minWidth: 140,
        flex: "1 1 140px",
      }}
    >
      <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: "1.25rem", fontWeight: 700, color }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: "0.75rem", opacity: 0.6 }}>{sub}</div>}
    </div>
  );
}

type BenchmarkRow = {
  label: string;
  value: number;
  pct: number;
  benchMin: number;
  benchMax: number;
  benchLabel: string;
  invert?: boolean;
};

const BENCH_GREEN = "#16a34a";
const BENCH_YELLOW = "#ca8a04";
const BENCH_RED = "#dc2626";

function benchColor(pct: number, min: number, max: number, invert?: boolean): string {
  if (invert) {
    if (pct <= min) return BENCH_GREEN;
    if (pct <= max) return BENCH_YELLOW;
    return BENCH_RED;
  }
  if (pct >= min) return BENCH_GREEN;
  if (pct >= max) return BENCH_YELLOW;
  return BENCH_RED;
}

function CostStructureTable({
  totals: ytdTotals,
  monthly,
  lastMonthLabel,
}: {
  totals: PnlPayload["totals"];
  monthly: PnlMonth[];
  lastMonthLabel: string;
}) {
  const [period, setPeriod] = useState<"ytd" | "last_month">("ytd");

  const lastMonth = monthly[monthly.length - 1] ?? null;

  const t = useMemo(() => {
    if (period === "ytd" || !lastMonth) return ytdTotals;
    return {
      total_revenue: lastMonth.total_revenue,
      cogs_journal: lastMonth.cogs_journal,
      cogs_estimated: lastMonth.cogs_estimated,
      cogs: lastMonth.cogs,
      gross_profit: lastMonth.gross_profit,
      total_opex: lastMonth.total_opex,
      contribution_margin: lastMonth.contribution_margin,
      marketing_spend: lastMonth.marketing_spend,
      staff_spend: lastMonth.staff_spend ?? 0,
    };
  }, [period, ytdTotals, lastMonth]);

  const monthsForAgg = period === "ytd" || !lastMonth ? monthly : [lastMonth];

  const rev = t.total_revenue || 1;
  const totalServices = monthsForAgg.reduce((s, m) => s + m.services, 0);
  const totalOther = monthsForAgg.reduce(
    (s, m) => s + m.material + m.representation + m.taxes_fees + m.other_operating + m.financial,
    0
  );
  const servicesNonMkStaff = Math.max(
    0,
    totalServices - t.marketing_spend - (t.staff_spend ?? 0)
  );

  const rows: BenchmarkRow[] = [
    {
      label: "COGS (náklady na tovar)",
      value: t.cogs,
      pct: t.cogs / rev,
      benchMin: 30,
      benchMax: 55,
      benchLabel: "30–55 %",
      invert: true,
    },
    {
      label: "Hrubá marža",
      value: t.gross_profit,
      pct: t.gross_profit / rev,
      benchMin: 45,
      benchMax: 70,
      benchLabel: "45–70 %",
    },
    {
      label: "Marketing",
      value: t.marketing_spend,
      pct: t.marketing_spend / rev,
      benchMin: 10,
      benchMax: 30,
      benchLabel: "10–30 %",
      invert: true,
    },
    {
      label: "Staff (mzdy cez služby)",
      value: t.staff_spend ?? 0,
      pct: (t.staff_spend ?? 0) / rev,
      benchMin: 15,
      benchMax: 35,
      benchLabel: "15–35 %",
      invert: true,
    },
    {
      label: "Služby (518 bez mk, staff)",
      value: servicesNonMkStaff,
      pct: servicesNonMkStaff / rev,
      benchMin: 5,
      benchMax: 15,
      benchLabel: "5–15 %",
      invert: true,
    },
    {
      label: "Ostatné prevádzkové",
      value: totalOther,
      pct: totalOther / rev,
      benchMin: 2,
      benchMax: 10,
      benchLabel: "2–10 %",
      invert: true,
    },
    {
      label: "OPEX spolu",
      value: t.total_opex,
      pct: t.total_opex / rev,
      benchMin: 20,
      benchMax: 50,
      benchLabel: "20–50 %",
      invert: true,
    },
    {
      label: "Contribution margin",
      value: t.contribution_margin,
      pct: t.contribution_margin / rev,
      benchMin: 10,
      benchMax: 30,
      benchLabel: "10–30 %",
    },
  ];

  const periodBtn = (active: boolean): React.CSSProperties => ({
    padding: "4px 10px",
    borderRadius: 6,
    border: "1px solid var(--border-strong)",
    background: active ? "rgba(59,130,246,0.15)" : "transparent",
    font: "inherit",
    fontSize: "0.8rem",
    cursor: "pointer",
    fontWeight: active ? 600 : 400,
  });

  return (
    <div style={{ marginTop: "2rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <h3 style={{ margin: 0 }}>Nákladová štruktúra vs. D2C e-commerce benchmark</h3>
        <div style={{ display: "flex", gap: "0.35rem" }} role="group" aria-label="Obdobie nákladovej štruktúry">
          <button type="button" style={periodBtn(period === "ytd")} onClick={() => setPeriod("ytd")}>
            YTD
          </button>
          <button
            type="button"
            style={periodBtn(period === "last_month")}
            onClick={() => setPeriod("last_month")}
          >
            {lastMonthLabel}
          </button>
        </div>
      </div>
      <p style={{ fontSize: "0.75rem", opacity: 0.6, marginBottom: "0.75rem", marginTop: "0.4rem" }}>
        Benchmarky sú orientačné pre D2C e-commerce (supplement/beauty) s vlastným fulfillmentom.
        Zelená = v norme, žltá = na hranici, červená = mimo normy.
      </p>
      <div className="table-wrap" style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Kategória</th>
              <th className="num">Suma</th>
              <th className="num">% z tržieb</th>
              <th className="num">D2C benchmark</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const pct100 = r.pct * 100;
              const color = benchColor(pct100, r.benchMin, r.benchMax, r.invert);
              return (
                <tr key={i}>
                  <td>{r.label}</td>
                  <td className="num">{formatMoney(r.value)}</td>
                  <td className="num" style={{ fontWeight: 700, color }}>
                    {formatPct(r.pct)}
                  </td>
                  <td className="num" style={{ fontSize: "0.8rem", opacity: 0.7 }}>
                    {r.benchLabel}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
