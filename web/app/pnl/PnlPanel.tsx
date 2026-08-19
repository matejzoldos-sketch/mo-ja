"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
            label: (ctx) => `${ctx.dataset.label}: ${formatMoney(ctx.parsed.y)}`,
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
      <h2 className="panel__title">
        P&L — Contribution Margin {meta.year}
      </h2>
      <p className="panel__note">{meta.note}</p>

      {/* KPI scorecards */}
      <div className="kpi-row" style={{ display: "flex", gap: "1rem", flexWrap: "wrap", margin: "1rem 0" }}>
        <KpiCard label="Tržby" value={formatMoney(t.total_revenue)} />
        <KpiCard label="COGS" value={formatMoney(t.cogs)} negative />
        <KpiCard label="Hrubá marža" value={formatMoney(t.gross_profit)} />
        <KpiCard label="OPEX" value={formatMoney(t.total_opex)} negative />
        <KpiCard
          label="Contribution margin"
          value={formatMoney(t.contribution_margin)}
          sub={formatPct(marginPct)}
          highlight={t.contribution_margin >= 0 ? "positive" : "negative"}
        />
        <KpiCard label="z toho marketing" value={formatMoney(t.marketing_spend)} />
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
              <th className="num">COGS</th>
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
