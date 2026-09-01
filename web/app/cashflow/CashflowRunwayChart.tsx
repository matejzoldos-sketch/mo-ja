"use client";

import { useMemo, useState } from "react";
import {
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
import { Line } from "react-chartjs-2";
import type { CashflowMonthRow } from "@/lib/cashflowMonthly";
import { OWNER_WITHDRAWALS_FREEZE_LABEL } from "@/lib/cashflowOwner";
import {
  buildCashflowRunway,
  CASHFLOW_RUNWAY_BUFFER_EUR,
  RUNWAY_SCENARIO_META,
  RUNWAY_SCENARIO_ORDER,
  runwayUntilLabel,
  type RunwayScenarioId,
} from "@/lib/cashflowRunway";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler
);

const TEXT = "#1a1f28";
const GRID = "rgba(15, 23, 42, 0.06)";
const ACTUAL = "#1a1f28";
const CONS = "hsl(0, 50%, 42%)";
const BASE = "#6b7f62";
const OPT = "hsl(152, 45%, 32%)";
const ZERO = "hsl(0, 50%, 42%)";
const BUFFER = "hsl(32, 70%, 38%)";

const SCENARIO_COLOR: Record<RunwayScenarioId, string> = {
  cons: CONS,
  base: BASE,
  opt: OPT,
};

function formatMoney(n: number, currency: string): string {
  return new Intl.NumberFormat("sk-SK", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

const HIDDEN_LEGEND = new Set(["Nula", "Vankúš 3 000 €"]);

type Props = {
  months: CashflowMonthRow[];
  currency: string;
};

export default function CashflowRunwayChart({ months, currency }: Props) {
  const [freezeOwner, setFreezeOwner] = useState(false);

  const runway = useMemo(
    () => buildCashflowRunway(months, { freezeOwner }),
    [months, freezeOwner]
  );

  const data = useMemo((): ChartData<"line"> | null => {
    if (!runway) return null;
    const scenarioDatasets = RUNWAY_SCENARIO_ORDER.map((id) => ({
      label: freezeOwner
        ? `${RUNWAY_SCENARIO_META[id].label} bez výberov Petra Škutila`
        : RUNWAY_SCENARIO_META[id].label,
      data: runway.scenarios[id],
      borderColor: SCENARIO_COLOR[id],
      backgroundColor: "transparent",
      borderWidth: 2,
      borderDash: [6, 4],
      pointRadius: 3,
      pointHoverRadius: 5,
      tension: 0.15,
      spanGaps: false,
    }));
    return {
      labels: runway.labels,
      datasets: [
        {
          label: "Skutočnosť",
          data: runway.actual,
          borderColor: ACTUAL,
          backgroundColor: "transparent",
          borderWidth: 2.5,
          pointBackgroundColor: ACTUAL,
          pointBorderColor: "#fff",
          pointRadius: 3,
          pointHoverRadius: 5,
          tension: 0.15,
          spanGaps: false,
        },
        ...scenarioDatasets,
        {
          label: "Nula",
          data: runway.labels.map(() => 0),
          borderColor: ZERO,
          backgroundColor: "transparent",
          borderWidth: 1,
          borderDash: [4, 4],
          pointRadius: 0,
          pointHoverRadius: 0,
          tension: 0,
        },
        {
          label: "Vankúš 3 000 €",
          data: runway.labels.map(() => CASHFLOW_RUNWAY_BUFFER_EUR),
          borderColor: BUFFER,
          backgroundColor: "transparent",
          borderWidth: 1,
          borderDash: [4, 4],
          pointRadius: 0,
          pointHoverRadius: 0,
          tension: 0,
        },
      ],
    };
  }, [freezeOwner, runway]);

  const options = useMemo(
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
            padding: 12,
            filter: (item) =>
              Boolean(item.text) && !HIDDEN_LEGEND.has(item.text ?? ""),
          },
        },
        tooltip: {
          filter(item) {
            return !HIDDEN_LEGEND.has(item.dataset.label ?? "");
          },
          callbacks: {
            label(ctx) {
              const label = ctx.dataset.label ?? "";
              const raw = ctx.parsed.y;
              if (raw == null || Number.isNaN(raw)) return "";
              return `${label}: ${formatMoney(raw, currency)}`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: TEXT,
            font: { family: "Manrope, sans-serif", size: 11 },
            maxRotation: 45,
            minRotation: 0,
          },
          grid: { color: GRID },
        },
        y: {
          ticks: {
            color: TEXT,
            font: { family: "Manrope, sans-serif", size: 11 },
            callback(value) {
              const n = typeof value === "number" ? value : Number(value);
              return formatMoney(n, currency);
            },
          },
          grid: { color: GRID },
        },
      },
    }),
    [currency]
  );

  if (!runway || !data) return null;

  return (
    <section
      className="chart-card chart-card--cashflow-runway"
      aria-labelledby="cashflow-runway-title"
    >
      <div className="chart-card__head chart-card__head--filter">
        <h2 id="cashflow-runway-title">Cash runway do konca roka</h2>
        <label className="cashflow-runway-check">
          <input
            type="checkbox"
            checked={freezeOwner}
            onChange={(e) => setFreezeOwner(e.target.checked)}
          />
          {OWNER_WITHDRAWALS_FREEZE_LABEL}
        </label>
      </div>
      <p className="chart-card__subtitle">
        Plná čiara = zostatok na konci mesiaca (aktuálny mesiac do dnes).
        Čiarkované = forecast sep–dec 2026 na hlavnom účte. Čiary nula a 3 000 €
        sú prahy. Karty: či na účte dôjde cash pred koncom roka.
      </p>
      <div className="cashflow-runway-wrap">
        <Line data={data} options={options} />
      </div>
      {runway.forecastMonths.length > 0 ? (
        <div className="cashflow-runway-kpis">
          {RUNWAY_SCENARIO_ORDER.map((id) => {
            const ye = runway.yearEnd[id];
            const hit = runway.firstBelowZero[id];
            const tone =
              hit && ye < 0
                ? "cashflow-runway-kpi--neg"
                : hit || ye < CASHFLOW_RUNWAY_BUFFER_EUR
                  ? "cashflow-runway-kpi--warn"
                  : "cashflow-runway-kpi--pos";
            return (
              <div key={id} className={`cashflow-runway-kpi ${tone}`}>
                <span className="cashflow-runway-kpi__label">
                  {RUNWAY_SCENARIO_META[id].label}
                </span>
                <span className="cashflow-runway-kpi__value">
                  {runwayUntilLabel(runway, id)}
                </span>
                <span className="cashflow-runway-kpi__meta">
                  Zostatok 31. 12. {formatMoney(ye, currency)}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="chart-card__subtitle cashflow-pie-note">
          Forecast na tento rok už nemá ďalšie mesiace — zostáva len skutočnosť.
        </p>
      )}
    </section>
  );
}
