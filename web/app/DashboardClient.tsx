"use client";

import { useCallback, useEffect, useState } from "react";
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

type RangeKey = "ytd" | "30d" | "90d" | "365d";

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
  { value: "365d", label: "Posledných 12 mesiacov" },
];

function parseRangeParam(raw: string | null): RangeKey {
  const s = (raw || "").toLowerCase().trim();
  if (s === "30d" || s === "90d" || s === "365d" || s === "ytd") return s;
  return "ytd";
}

const PRIMARY = "#f7f775";
const SECONDARY = "#9d9a89";
const TEXT = "#333333";
const GRID = "rgba(51,51,51,0.08)";

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

export default function DashboardClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rangeFromUrl = parseRangeParam(searchParams.get("range"));
  const [range, setRange] = useState<RangeKey>(rangeFromUrl);

  useEffect(() => {
    setRange(rangeFromUrl);
  }, [rangeFromUrl]);

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

  const lineData = data
    ? {
        labels: data.dailyRevenue.map((d) => d.date),
        datasets: [
          {
            label: "Tržby (deň)",
            data: data.dailyRevenue.map((d) => Number(d.revenue)),
            borderColor: SECONDARY,
            backgroundColor: "rgba(157, 154, 137, 0.15)",
            fill: true,
            tension: 0.25,
            pointBackgroundColor: PRIMARY,
            pointBorderColor: TEXT,
            pointRadius: 3,
          },
        ],
      }
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

  return (
    <>
      <header className="site-header">
        <div className="site-header__inner">
          <h1>MOJA PHASE — predaj</h1>
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
            <code>002_dashboard_mvp.sql</code>, <code>003_dashboard_range.sql</code>.
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
                  <div style={{ height: 260 }}>
                    <Line data={lineData} options={chartOptions} />
                  </div>
                ) : null}
              </div>
              <div className="chart-card" style={{ minHeight: 320 }}>
                <h2>
                  Top 5 produktov (tržby)
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
