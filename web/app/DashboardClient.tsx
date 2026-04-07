"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line, Bar } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

type Kpis = {
  revenue: number;
  orders: number;
  aov: number;
  currency: string | null;
};

type Daily = { date: string; revenue: number };
type TopProduct = { label: string; revenue: number; units: number };
type RecentOrder = {
  id: number;
  name: string;
  created_at: string;
  financial_status: string | null;
  fulfillment_status: string | null;
  customer_display_name: string | null;
  total_price: number;
  currency: string | null;
};

type RangeKey = "ytd" | "30d" | "90d";

type PayloadMeta = { range: string; from: string; to: string };

type Payload = {
  meta: PayloadMeta;
  kpis: Kpis;
  dailyRevenue: Daily[];
  topProducts: TopProduct[];
  recentOrders: RecentOrder[];
};

const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: "ytd", label: "Od začiatku roka" },
  { value: "30d", label: "Posledných 30 dní" },
  { value: "90d", label: "Posledných 90 dní" },
];

function parseRangeParam(raw: string | null): RangeKey {
  const s = (raw || "").toLowerCase().trim();
  if (s === "30d" || s === "90d" || s === "ytd") return s;
  return "ytd";
}

const PRIMARY = "#f7f775";
const SECONDARY = "#9d9a89";
const TEXT = "#333333";
const GRID = "rgba(51,51,51,0.08)";
const TREND_LINE = "rgba(51, 51, 51, 0.5)";

function formatSkDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d}. ${m}. ${y}`;
}

function formatMoney(amount: number, currency: string | null) {
  const c = currency || "EUR";
  try {
    return new Intl.NumberFormat("sk-SK", {
      style: "currency",
      currency: c,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${c}`;
  }
}

/** Least-squares line through points (i, y[i]); one point → flat line. */
function linearTrendSeries(y: number[]): number[] {
  const n = y.length;
  if (n === 0) return [];
  if (n === 1) return [y[0]];
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += y[i];
    sumXY += i * y[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return y.slice();
  const m = (n * sumXY - sumX * sumY) / denom;
  const b = (sumY - m * sumX) / n;
  return y.map((_, i) => m * i + b);
}

const DOW_SK = ["Po", "Ut", "St", "Št", "Pi", "So", "Ne"];

type HeatCell = { iso: string; inRange: boolean; revenue: number };

function utcDateFromIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
}

function isoFromUtcDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addUtcDays(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

/** Monday = 0 … Sunday = 6 (UTC calendar day). */
function mondayIndexUtc(d: Date): number {
  const w = d.getUTCDay();
  return w === 0 ? 6 : w - 1;
}

function mondayOnOrBeforeUtc(d: Date): Date {
  return addUtcDays(d, -mondayIndexUtc(d));
}

function sundayOnOrAfterUtc(d: Date): Date {
  return addUtcDays(d, 6 - mondayIndexUtc(d));
}

function buildSalesHeatmapColumns(
  daily: Daily[],
  fromIso: string,
  toIso: string
): { columns: HeatCell[][]; maxRev: number } {
  const rev = new Map(daily.map((x) => [x.date, Number(x.revenue)]));
  const fromD = utcDateFromIso(fromIso);
  const toD = utcDateFromIso(toIso);
  const gridStart = mondayOnOrBeforeUtc(fromD);
  const gridEnd = sundayOnOrAfterUtc(toD);
  const columns: HeatCell[][] = [];
  let cursor = new Date(gridStart.getTime());
  const endMs = gridEnd.getTime();
  while (cursor.getTime() <= endMs) {
    const col: HeatCell[] = [];
    for (let i = 0; i < 7; i++) {
      const cellD = addUtcDays(cursor, i);
      const iso = isoFromUtcDate(cellD);
      const inRange = iso >= fromIso && iso <= toIso;
      const revenue = inRange ? rev.get(iso) ?? 0 : 0;
      col.push({ iso, inRange, revenue });
    }
    columns.push(col);
    cursor = addUtcDays(cursor, 7);
  }
  let maxRev = 0;
  for (const col of columns) {
    for (const c of col) {
      if (c.inRange && c.revenue > maxRev) maxRev = c.revenue;
    }
  }
  return { columns, maxRev };
}

function heatmapCellBackground(
  inRange: boolean,
  revenue: number,
  maxRev: number
): string {
  if (!inRange) return "transparent";
  if (maxRev <= 0) return "rgba(157, 154, 137, 0.06)";
  const t = Math.min(1, revenue / maxRev);
  const alpha = 0.1 + t * 0.82;
  return `rgba(157, 154, 137, ${alpha})`;
}

export default function DashboardClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rangeFromUrl = parseRangeParam(searchParams.get("range"));
  const [range, setRange] = useState<RangeKey>(rangeFromUrl);

  useEffect(() => {
    setRange(rangeFromUrl);
  }, [rangeFromUrl]);

  useEffect(() => {
    const raw = searchParams.get("range");
    if (!raw) return;
    const s = raw.toLowerCase().trim();
    if (s === "30d" || s === "90d" || s === "ytd") return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("range");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, pathname, router]);

  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (r: RangeKey) => {
    setLoading(true);
    setErr(null);
    try {
      const q = r === "ytd" ? "" : `?range=${encodeURIComponent(r)}`;
      const res = await fetch(`/api/dashboard${q}`);
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || `HTTP ${res.status}`);
        setData(null);
        return;
      }
      setData(json as Payload);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Fetch failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(range);
  }, [load, range]);

  function onRangeChange(next: RangeKey) {
    setRange(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "ytd") params.delete("range");
    else params.set("range", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const periodLabel = data?.meta
    ? data.meta.range === "ytd"
      ? `YTD ${data.meta.from.slice(0, 4)}`
      : `${formatSkDate(data.meta.from)} – ${formatSkDate(data.meta.to)}`
    : "";

  const heatmapModel = useMemo(() => {
    if (!data?.meta) return null;
    return buildSalesHeatmapColumns(
      data.dailyRevenue,
      data.meta.from,
      data.meta.to
    );
  }, [data]);

  const lineData = data
    ? (() => {
        const revenues = data.dailyRevenue.map((d) => Number(d.revenue));
        const trend = linearTrendSeries(revenues);
        return {
          labels: data.dailyRevenue.map((d) => d.date),
          datasets: [
            {
              label: "Tržby (deň)",
              data: revenues,
              borderColor: SECONDARY,
              backgroundColor: "rgba(157, 154, 137, 0.15)",
              fill: true,
              tension: 0.25,
              pointBackgroundColor: PRIMARY,
              pointBorderColor: TEXT,
              pointRadius: 3,
            },
            {
              label: "Trend (lineárna)",
              data: trend,
              borderColor: TREND_LINE,
              borderWidth: 2,
              borderDash: [6, 4],
              pointRadius: 0,
              pointHoverRadius: 0,
              fill: false,
              tension: 0,
            },
          ],
        };
      })()
    : null;

  const barData = data
    ? {
        labels: data.topProducts.map((p) =>
          p.label.length > 28 ? `${p.label.slice(0, 26)}…` : p.label
        ),
        datasets: [
          {
            label: "Tržby",
            data: data.topProducts.map((p) => Number(p.revenue)),
            backgroundColor: PRIMARY,
            borderColor: TEXT,
            borderWidth: 1,
          },
        ],
      }
    : null;

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: TEXT, font: { family: "Manrope" } },
      },
    },
    scales: {
      x: {
        ticks: { color: TEXT, maxRotation: 45, minRotation: 0 },
        grid: { color: GRID },
      },
      y: {
        ticks: { color: TEXT },
        grid: { color: GRID },
        beginAtZero: true,
      },
    },
  };

  const lineChartOptions = {
    ...chartOptions,
    plugins: {
      ...chartOptions.plugins,
      legend: { display: false as const },
    },
  };

  return (
    <>
      <header className="site-header">
        <div className="site-header__inner">
          <h1>MO–JA dashboard</h1>
          <label className="period-filter">
            <span className="period-filter__label">Obdobie</span>
            <select
              className="period-filter__select"
              value={range}
              onChange={(e) => onRangeChange(e.target.value as RangeKey)}
              aria-label="Časové obdobie dashboardu"
            >
              {RANGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <main className="main-wrap">
        {loading && <p className="msg">Načítavam…</p>}
        {err && !loading && (
          <p className="msg msg-error">
            {err}{" "}
            Skontroluj env na Verceli (<code>SUPABASE_URL</code>,{" "}
            <code>SUPABASE_SERVICE_ROLE_KEY</code>) a migráciu{" "}
            <code>002_dashboard_mvp.sql</code>, <code>003_dashboard_range.sql</code>,{" "}
            <code>004_dashboard_remove_365d.sql</code>.
          </p>
        )}
        {data && !loading && (
          <>
            <section className="kpi-grid">
              <div className="kpi-card">
                <div className="kpi-card__label">
                  Obrat{periodLabel ? ` (${periodLabel})` : ""}
                </div>
                <div className="kpi-card__value">
                  {formatMoney(Number(data.kpis.revenue), data.kpis.currency)}
                </div>
              </div>
              <div className="kpi-card">
                <div className="kpi-card__label">Počet objednávok</div>
                <div className="kpi-card__value">{data.kpis.orders}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-card__label">AOV</div>
                <div className="kpi-card__value">
                  {formatMoney(Number(data.kpis.aov), data.kpis.currency)}
                </div>
              </div>
            </section>

            <section className="charts-row">
              <div className="chart-card" style={{ minHeight: 320 }}>
                <h2>
                  Tržby po dňoch
                  {periodLabel ? ` (${periodLabel})` : ""}
                </h2>
                {lineData ? (
                  <div className="line-chart-block">
                    <div className="line-chart-block__canvas">
                      <Line data={lineData} options={lineChartOptions} />
                    </div>
                    <ul
                      className="chart-legend-minimal"
                      aria-label="Legenda grafu tržieb"
                    >
                      <li className="chart-legend-minimal__item">
                        <span
                          className="chart-legend-minimal__mark chart-legend-minimal__mark--fill"
                          style={{ backgroundColor: SECONDARY }}
                          aria-hidden
                        />
                        <span>Tržby (deň)</span>
                      </li>
                      <li className="chart-legend-minimal__item">
                        <span
                          className="chart-legend-minimal__mark chart-legend-minimal__mark--dash"
                          style={{
                            backgroundImage: `repeating-linear-gradient(90deg, ${TREND_LINE} 0, ${TREND_LINE} 4px, transparent 4px, transparent 7px)`,
                          }}
                          aria-hidden
                        />
                        <span>Trend (lineárna)</span>
                      </li>
                    </ul>
                  </div>
                ) : null}
              </div>
              <div className="chart-card" style={{ minHeight: 320 }}>
                <h2>
                  Tržby podľa produktu
                  {periodLabel ? ` (${periodLabel})` : ""}
                </h2>
                {barData ? (
                  <div style={{ height: 260 }}>
                    <Bar
                      data={barData}
                      options={{
                        ...chartOptions,
                        indexAxis: "y" as const,
                      }}
                    />
                  </div>
                ) : null}
              </div>
            </section>

            {heatmapModel && heatmapModel.columns.length > 0 ? (
              <section className="chart-card heatmap-card">
                <h2>
                  Heat mapa tržieb (po dňoch)
                  {periodLabel ? ` (${periodLabel})` : ""}
                </h2>
                <p className="heatmap-card__hint">
                  Každý štvorček je jeden deň; intenzita = tržby v ten deň (v rámci
                  zvoleného obdobia).
                </p>
                <div className="heatmap">
                  <div className="heatmap__scroll" role="grid" aria-label="Tržby po dňoch">
                    {DOW_SK.map((dowLabel, dow) => (
                      <div key={dowLabel} className="heatmap__row" role="row">
                        <div className="heatmap__row-label" role="rowheader">
                          {dowLabel}
                        </div>
                        <div className="heatmap__row-cells">
                          {heatmapModel.columns.map((week, wi) => {
                            const cell = week[dow];
                            const title = cell.inRange
                              ? `${formatSkDate(cell.iso)}: ${formatMoney(
                                  cell.revenue,
                                  data.kpis.currency
                                )}`
                              : "";
                            return (
                              <div
                                key={`${wi}-${cell.iso}`}
                                className="heatmap__cell-wrap"
                                role="gridcell"
                                title={title}
                              >
                                {cell.inRange ? (
                                  <div
                                    className="heatmap__cell"
                                    style={{
                                      backgroundColor: heatmapCellBackground(
                                        cell.inRange,
                                        cell.revenue,
                                        heatmapModel.maxRev
                                      ),
                                    }}
                                  />
                                ) : (
                                  <div className="heatmap__cell heatmap__cell--empty" />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="heatmap__scale" aria-hidden>
                  <span>menej</span>
                  <div
                    className="heatmap__scale-bar"
                    style={{
                      background: `linear-gradient(90deg, rgba(157,154,137,0.1), rgba(157,154,137,0.92))`,
                    }}
                  />
                  <span>viac</span>
                </div>
              </section>
            ) : null}

            <section className="table-card">
              <h2>
                10 najnovších objednávok v období
                {periodLabel ? ` (${periodLabel})` : ""}
              </h2>
              <table>
                <thead>
                  <tr>
                    <th>Objednávka</th>
                    <th>Dátum</th>
                    <th>Zákazník</th>
                    <th>Platba</th>
                    <th>Vybavenie</th>
                    <th>Suma</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentOrders.map((o) => (
                    <tr key={o.id}>
                      <td>{o.name}</td>
                      <td>{o.created_at}</td>
                      <td>{o.customer_display_name || "—"}</td>
                      <td>{o.financial_status || "—"}</td>
                      <td>{o.fulfillment_status || "—"}</td>
                      <td>
                        {formatMoney(
                          Number(o.total_price),
                          o.currency || data.kpis.currency
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
      </main>
    </>
  );
}
