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
  contribution_margin: number;
};

type TopExpense = {
  supplier: string;
  account_prefix: string;
  amount_eur: number;
  line_count: number;
};

type PnlPayload = {
  meta: {
    year: string;
    from: string;
    to: string;
    note: string;
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
  };
  monthly: PnlMonth[];
  topExpenses: TopExpense[];
};

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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfExporting, setPdfExporting] = useState(false);
  const pdfExportRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/pnl", { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const buildMarkdown = useCallback((): string => {
    if (!data) return "";
    const { totals: t, monthly, topExpenses, meta } = data;
    const mPct = t.total_revenue ? ((t.contribution_margin / t.total_revenue) * 100).toFixed(1) : "–";
    const mkPct = t.total_revenue ? ((t.marketing_spend / t.total_revenue) * 100).toFixed(1) : "–";
    let md = `# P&L — Contribution Margin ${meta.year}\n\n`;
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
  }, [data]);

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
  }, [data]);

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

  return (
    <section className="panel">
      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginBottom: "0.5rem" }}>
        <button type="button" className="btn btn--outline btn--sm" onClick={downloadMd}>
          Stiahnuť MD
        </button>
        <button type="button" className="btn btn--outline btn--sm" onClick={downloadPdf} disabled={pdfExporting}>
          {pdfExporting ? "Generujem PDF…" : "Stiahnuť PDF"}
        </button>
      </div>

      <div className="dashboard-pdf-root" ref={pdfExportRef}>
      <h2 className="panel__title">
        P&L — Contribution Margin {meta.year}
      </h2>
      <p className="panel__note">{meta.note}</p>

      {/* KPI scorecards */}
      <div className="kpi-row" style={{ display: "flex", gap: "1rem", flexWrap: "wrap", margin: "1rem 0" }}>
        <KpiCard label="Tržby" value={formatMoney(t.total_revenue)} />
        <KpiCard label="COGS" value={formatMoney(t.cogs)} negative sub={t.cogs_journal < t.cogs_estimated ? "odhad 49,5 % z tovaru" : "z denníka (504)"} />
        <KpiCard label="Hrubá marža" value={formatMoney(t.gross_profit)} />
        <KpiCard label="OPEX" value={formatMoney(t.total_opex)} negative />
        <KpiCard
          label="Contribution margin"
          value={formatMoney(t.contribution_margin)}
          sub={formatPct(marginPct)}
          highlight={t.contribution_margin >= 0 ? "positive" : "negative"}
        />
        <KpiCard label="z toho marketing" value={formatMoney(t.marketing_spend)} sub={t.total_revenue ? formatPct(t.marketing_spend / t.total_revenue) + " z tržieb" : undefined} />
      </div>

      {/* Chart */}
      {chartData && (
        <div style={{ height: 340, marginBottom: "1.5rem" }}>
          <Bar data={chartData} options={chartOpts} />
        </div>
      )}

      {/* Monthly table */}
      <div className="table-wrap" style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Mesiac</th>
              <th className="num">Tržby tovar</th>
              <th className="num">Tržby služby</th>
              <th className="num">Spolu tržby</th>
              <th className="num" title="COGS = max(denník 504, odhad 49,5 % tržieb za tovar)">COGS*</th>
              <th className="num">Hrubá marža</th>
              <th className="num">Služby (518)</th>
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
              return (
                <tr key={m.month_key}>
                  <td>{monthLabel(m.month_key)}</td>
                  <td className="num">{formatMoney(m.sales_goods)}</td>
                  <td className="num">{formatMoney(m.sales_services)}</td>
                  <td className="num">{formatMoney(m.total_revenue)}</td>
                  <td className="num">{formatMoney(m.cogs)}</td>
                  <td className="num">{formatMoney(m.gross_profit)}</td>
                  <td className="num">{formatMoney(m.services)}</td>
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
              <td className="num">{formatMoney(monthly.reduce((s, m) => s + m.services, 0))}</td>
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
      </div>

      <p style={{ fontSize: "0.75rem", opacity: 0.6, marginTop: "0.5rem" }}>
        * COGS = vyššia z hodnôt: účet 504 z denníka vs. odhad 49,5 % tržieb za tovar.
        Odhad vychádza z produktovej kalkulácie (marža ~50 % vrátane fulfillmentu, platobnej brány a prepravy).
      </p>

      {/* Cost structure vs benchmark */}
      <CostStructureTable totals={t} monthly={monthly} />

      {/* Top expenses */}
      <h3 style={{ marginTop: "2rem" }}>Top 20 dodávateľov (náklady)</h3>
      <div className="table-wrap" style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Dodávateľ</th>
              <th>Účet</th>
              <th className="num">Suma</th>
              <th className="num">Riadkov</th>
            </tr>
          </thead>
          <tbody>
            {topExpenses.map((e, i) => (
              <tr key={i}>
                <td>{e.supplier}</td>
                <td>{ACCOUNT_LABELS[e.account_prefix] ?? e.account_prefix}</td>
                <td className="num">{formatMoney(e.amount_eur)}</td>
                <td className="num">{e.line_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>
    </section>
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
  totals: t,
  monthly,
}: {
  totals: PnlPayload["totals"];
  monthly: PnlMonth[];
}) {
  const rev = t.total_revenue || 1;
  const totalServices = monthly.reduce((s, m) => s + m.services, 0);
  const totalOther = monthly.reduce(
    (s, m) => s + m.material + m.representation + m.taxes_fees + m.other_operating + m.financial,
    0
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
      label: "Služby (518 bez marketingu)",
      value: totalServices - t.marketing_spend,
      pct: (totalServices - t.marketing_spend) / rev,
      benchMin: 5,
      benchMax: 20,
      benchLabel: "5–20 %",
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

  return (
    <div style={{ marginTop: "2rem" }}>
      <h3>Nákladová štruktúra vs. D2C e-commerce benchmark</h3>
      <p style={{ fontSize: "0.75rem", opacity: 0.6, marginBottom: "0.75rem" }}>
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
              <th style={{ minWidth: 160 }}>Vizuál</th>
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
                  <td>
                    <div style={{
                      position: "relative",
                      height: 18,
                      background: "var(--clr-surface, #f1f5f9)",
                      borderRadius: 4,
                      overflow: "hidden",
                    }}>
                      <div style={{
                        position: "absolute",
                        left: `${r.benchMin}%`,
                        width: `${r.benchMax - r.benchMin}%`,
                        height: "100%",
                        background: "rgba(34,197,94,0.15)",
                        borderLeft: "1px solid rgba(34,197,94,0.4)",
                        borderRight: "1px solid rgba(34,197,94,0.4)",
                      }} />
                      <div style={{
                        position: "absolute",
                        left: `${Math.min(pct100, 100)}%`,
                        top: 0,
                        width: 3,
                        height: "100%",
                        background: color,
                        borderRadius: 2,
                        transform: "translateX(-1.5px)",
                      }} />
                    </div>
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
