"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import type { ChartData, ChartOptions } from "chart.js";
import { Line, Bar } from "react-chartjs-2";
import { HeaderBrand, HeaderSectionSelect } from "./components/HeaderNav";
import { formatLastSyncDisplay } from "@/lib/formatLastSync";

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
  /** % distinct customers in window with a prior paid-ish order before window; null if no known customer_id in window */
  returning_customers_pct?: number | null;
};

type Daily = { date: string; revenue: number };
type TopProduct = { label: string; revenue: number; units: number };
/** Bez mena/emailu — len Shopify customer legacy id z objednávok. */
type TopCustomer = {
  customer_id: number;
  orders: number;
  revenue: number;
  currency: string | null;
};
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

type RangeKey = "365d" | "30d" | "90d";

type PayloadMeta = { range: string; from: string; to: string };

type SkuDailyYtd = {
  year: number;
  from: string;
  to: string;
  skuOrder: string[];
  points: { date: string; sku: string; units: number }[];
};

type Payload = {
  meta: PayloadMeta;
  kpis: Kpis;
  dailyRevenue: Daily[];
  topProducts: TopProduct[];
  topCustomers?: TopCustomer[];
  recentOrders: RecentOrder[];
  skuDailyYtd?: SkuDailyYtd;
  /** ISO čas posledného úspešného behu sync_shopify (shopify_sync_state.full_sync) */
  lastSyncAt?: string | null;
};

const RANGE_LABELS: Record<RangeKey, string> = {
  "30d": "Posledných 30 dní",
  "90d": "Posledných 90 dní",
  "365d": "Posledných 12 mesiacov",
};

/** Poradie v menu: najprv kratšie rolling okná, nakoniec ~12 mesiacov (365 dní). */
const RANGE_ORDER: readonly RangeKey[] = ["30d", "90d", "365d"];

function parseRangeParam(raw: string | null): RangeKey {
  const s = (raw || "").toLowerCase().trim();
  if (s === "ytd") return "365d";
  if (s === "30d" || s === "90d" || s === "365d") return s;
  return "30d";
}

const PRIMARY = "#f7f775";
const SECONDARY = "#9d9a89";
const TEXT = "#333333";
const GRID = "rgba(51,51,51,0.08)";
const TREND_LINE = "rgba(51, 51, 51, 0.5)";

/** Suffix on trend dataset labels; filtered out of legend (still in tooltip). */
const SKU_CHART_TREND_SUFFIX = " (trend)";

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

function formatReturningPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }
  return `${Number(value).toLocaleString("sk-SK", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} %`;
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

function enumerateInclusiveDays(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  const cur = new Date(Date.UTC(fy, (fm || 1) - 1, fd || 1));
  const end = new Date(Date.UTC(ty, (tm || 1) - 1, td || 1));
  while (cur.getTime() <= end.getTime()) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, "0");
    const d = String(cur.getUTCDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function skuLineColor(i: number, total: number): string {
  const step = total > 0 ? 360 / total : 0;
  const h = Math.round((i * step) % 360);
  return `hsl(${h} 42% 38%)`;
}

function buildSkuUnitsLineChart(
  s: SkuDailyYtd | undefined
): ChartData<"line"> | null {
  if (!s?.skuOrder?.length) return null;
  const days = enumerateInclusiveDays(s.from, s.to);
  if (days.length === 0) return null;
  const key = (d: string, sku: string) => `${d}|${sku}`;
  const m = new Map<string, number>();
  for (const p of s.points) {
    m.set(key(p.date, p.sku), Number(p.units));
  }
  const n = s.skuOrder.length;
  const datasets: ChartData<"line">["datasets"] = [];
  for (let i = 0; i < s.skuOrder.length; i++) {
    const sku = s.skuOrder[i];
    const label = sku.length > 40 ? `${sku.slice(0, 38)}…` : sku;
    const color = skuLineColor(i, n);
    const row = days.map((d) => m.get(key(d, sku)) ?? 0);
    datasets.push({
      label,
      data: row,
      borderColor: color,
      backgroundColor: "transparent",
      fill: false,
      tension: 0.2,
      pointRadius: 0,
      pointHoverRadius: 4,
      borderWidth: 2,
    });
    datasets.push({
      label: `${label}${SKU_CHART_TREND_SUFFIX}`,
      data: linearTrendSeries(row),
      borderColor: color,
      backgroundColor: "transparent",
      fill: false,
      tension: 0,
      borderWidth: 2,
      borderDash: [5, 5],
      pointRadius: 0,
      pointHoverRadius: 0,
    });
  }
  return { labels: days, datasets };
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
    if (s === "ytd") {
      const params = new URLSearchParams(searchParams.toString());
      params.set("range", "365d");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      return;
    }
    if (s === "30d" || s === "90d" || s === "365d") return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("range");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, pathname, router]);

  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rangeMenuOpen, setRangeMenuOpen] = useState(false);
  const rangeMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rangeMenuOpen) return;
    const close = () => setRangeMenuOpen(false);
    const onDown = (e: MouseEvent) => {
      if (rangeMenuRef.current?.contains(e.target as Node)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [rangeMenuOpen]);

  const load = useCallback(async (r: RangeKey) => {
    setLoading(true);
    setErr(null);
    try {
      const q = `?range=${encodeURIComponent(r)}&_=${Date.now()}`;
      const fetchOpts: RequestInit = {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      };
      const [mainRes, skuRes] = await Promise.all([
        fetch(`/api/dashboard${q}`, fetchOpts),
        fetch(`/api/dashboard/sku-ytd?_=${Date.now()}`, fetchOpts),
      ]);
      const mainJson = (await mainRes.json()) as Payload & { error?: string };
      if (!mainRes.ok) {
        setErr(mainJson.error || `HTTP ${mainRes.status}`);
        setData(null);
        return;
      }
      let skuDailyYtd = mainJson.skuDailyYtd;
      if (skuRes.ok) {
        const sj = (await skuRes.json()) as {
          error?: string;
          skuDailyYtd?: SkuDailyYtd;
        };
        if (!sj.error && sj.skuDailyYtd !== undefined) {
          skuDailyYtd = sj.skuDailyYtd;
        }
      }
      setData({ ...mainJson, skuDailyYtd } as Payload);
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

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void load(range);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load, range]);

  function onRangeChange(next: RangeKey) {
    setRangeMenuOpen(false);
    setRange(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const periodLabel = data?.meta
    ? `${formatSkDate(data.meta.from)} – ${formatSkDate(data.meta.to)}`
    : "";

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

  const skuYtdLineData = data?.skuDailyYtd
    ? buildSkuUnitsLineChart(data.skuDailyYtd)
    : null;

  const skuYtdLineOptions: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "bottom",
        labels: {
          color: TEXT,
          font: { family: "Manrope", size: 11 },
          boxWidth: 12,
          padding: 10,
          usePointStyle: true,
          pointStyle: "line",
          filter: (item) =>
            typeof item.text === "string" &&
            !item.text.endsWith(SKU_CHART_TREND_SUFFIX),
        },
      },
      tooltip: {
        mode: "index",
        intersect: false,
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
    interaction: {
      mode: "nearest",
      axis: "x",
      intersect: false,
    },
  };

  return (
    <>
      <header className="site-header">
        <div className="site-header__inner">
          <HeaderBrand />
          <div className="site-header__dropdowns">
            <HeaderSectionSelect />
            <div
              className="period-filter period-filter--range"
              ref={rangeMenuRef}
            >
              <button
                type="button"
                className="period-filter__select period-filter__select--range-trigger"
                aria-expanded={rangeMenuOpen}
                aria-haspopup="listbox"
                aria-label="Obdobie"
                onClick={() => setRangeMenuOpen((o) => !o)}
              >
                <span>{RANGE_LABELS[range]}</span>
                <span className="period-filter__chevron" aria-hidden>
                  ▼
                </span>
              </button>
              {rangeMenuOpen ? (
                <ul
                  className="period-filter__range-list"
                  role="listbox"
                  aria-label="Obdobie"
                >
                  {RANGE_ORDER.map((v) => (
                    <li key={v} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected={v === range}
                        className={
                          v === range
                            ? "period-filter__range-option is-selected"
                            : "period-filter__range-option"
                        }
                        onClick={() => onRangeChange(v)}
                      >
                        {v === range ? "✓ " : ""}
                        {RANGE_LABELS[v]}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        </div>
        {data?.lastSyncAt != null && data.lastSyncAt !== "" && (
          <p className="site-header__sync-meta">
            Posledný sync dát: {formatLastSyncDisplay(data.lastSyncAt)}
          </p>
        )}
      </header>

      <main className="main-wrap">
        {loading && <p className="msg">Načítavam…</p>}
        {err && !loading && (
          <p className="msg msg-error">
            {err}{" "}
            Skontroluj env na Verceli (<code>SUPABASE_URL</code>,{" "}
            <code>SUPABASE_SERVICE_ROLE_KEY</code>) a migráciu{" "}
            <code>002_dashboard_mvp.sql</code>, <code>003_dashboard_range.sql</code>,{" "}
            <code>004_dashboard_remove_365d.sql</code>,{" "}
            <code>015_shopify_orders_customer_id_returning_kpi.sql</code>,{" "}
            <code>016_returning_kpi_effective_customer_id.sql</code>,{" "}
            <code>017_returning_kpi_order_email.sql</code>,{" "}
            <code>018_ytd_returning_repeat_within_year.sql</code>,{" "}
            <code>024_dashboard_top_customers_by_id.sql</code>,{" "}
            <code>025_shopify_order_effective_customer_id_if_missing.sql</code>,{" "}
            <code>005_inventory_dashboard_rpc.sql</code> (sklad),{" "}
            <code>006_sku_units_daily_ytd.sql</code>.
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
              {range === "365d" && (
                <div
                  className="kpi-card"
                  title="Posledných 365 dní: zákazníci cez customer ID alebo email objednávky (paid / čiastočne zaplatené / čiastočne refundované). % tých, čo mali aspoň jednu takú objednávku pred začiatkom okna, zo všetkých s aspoň jednou v okne."
                >
                  <div className="kpi-card__label">
                    Vracajúci sa zákazníci
                    {periodLabel ? ` (${periodLabel})` : ""}
                  </div>
                  <div className="kpi-card__value">
                    {formatReturningPct(data.kpis.returning_customers_pct)}
                  </div>
                </div>
              )}
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

            {(data.topCustomers?.length ?? 0) > 0 ? (
              <section className="table-card">
                <h2>
                  Top zákazníci podľa Shopify customer ID
                  {periodLabel ? ` (${periodLabel})` : ""}
                </h2>
                <p className="chart-card__subtitle">
                  Len objednávky so známym customer ID (bez mena a emailu v tejto tabuľke).
                  Hosťovské / len-email objednávky tu nie sú.
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>Customer ID</th>
                      <th>Objednávky</th>
                      <th>Tržby</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.topCustomers ?? []).map((c) => (
                      <tr key={c.customer_id}>
                        <td>
                          <code>{c.customer_id}</code>
                        </td>
                        <td>{c.orders}</td>
                        <td>
                          {formatMoney(
                            Number(c.revenue),
                            c.currency || data.kpis.currency
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}

            {data.skuDailyYtd && skuYtdLineData ? (
              <section className="chart-card chart-card--sku-ytd">
                <h2>
                  Denné predané kusy podľa SKU (od 1. 1. {data.skuDailyYtd.year})
                </h2>
                <div className="sku-ytd-chart-wrap">
                  <Line data={skuYtdLineData} options={skuYtdLineOptions} />
                </div>
              </section>
            ) : data.skuDailyYtd &&
              data.skuDailyYtd.skuOrder.length === 0 &&
              skuYtdLineData === null ? (
              <section className="chart-card chart-card--sku-ytd">
                <h2>
                  Denné predané kusy podľa SKU (od 1. 1. {data.skuDailyYtd.year})
                </h2>
                <p className="msg">Zatiaľ žiadne predaje v tomto roku.</p>
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
