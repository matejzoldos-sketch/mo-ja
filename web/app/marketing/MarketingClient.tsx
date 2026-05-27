"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
} from "chart.js";
import type { ChartData, ChartOptions } from "chart.js";
import { Pie } from "react-chartjs-2";
import { HeaderBrand, HeaderSectionSelect } from "../components/HeaderNav";

ChartJS.register(ArcElement, Tooltip, Legend);

type RangeKey = "30d" | "90d" | "365d";
type DimensionKey = "source" | "medium" | "campaign";

type BreakdownRow = {
  label: string;
  orders: number;
  revenue: number;
  pct_orders: number;
  pct_revenue: number;
};

type MarketingPayload = {
  meta: { range: string; from: string; to: string };
  kpis: {
    orders: number;
    orders_with_utm: number;
    orders_without_utm: number;
    revenue: number;
    currency: string;
    pct_orders_with_utm: number | null;
  };
  bySource: BreakdownRow[];
  byMedium: BreakdownRow[];
  byCampaign: BreakdownRow[];
  recentOrders: {
    id: number;
    name: string;
    created_at: string;
    revenue: number;
    currency: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    channel_source: string;
    utm_landing_page: string | null;
    utm_attribution_ready: boolean | null;
  }[];
};

const RANGE_LABELS: Record<RangeKey, string> = {
  "30d": "Posledných 30 dní",
  "90d": "Posledných 90 dní",
  "365d": "Od spustenia (Nov 2025 – Súčasnosť)",
};
const RANGE_ORDER: readonly RangeKey[] = ["30d", "90d", "365d"];

const DIMENSION_LABELS: Record<DimensionKey, string> = {
  source: "Zdroj (UTM source)",
  medium: "Medium (UTM medium)",
  campaign: "Kampaň (UTM campaign)",
};

const PIE_COLORS = [
  "#f5c518",
  "#1a1f28",
  "#5b8def",
  "#e07b4a",
  "#6bbf8a",
  "#9b7ede",
  "#d4a574",
  "#4a9ba8",
  "#c45c8a",
  "#8a9ba8",
];

const TEXT = "#1a1f28";

function parseRangeParam(raw: string | null): RangeKey {
  const s = (raw || "").toLowerCase().trim();
  if (s === "ytd" || s === "all" || s === "365d") return "365d";
  if (s === "30d" || s === "90d") return s;
  return "90d";
}

function parseDimensionParam(raw: string | null): DimensionKey {
  const s = (raw || "").toLowerCase().trim();
  if (s === "medium" || s === "campaign") return s;
  return "source";
}

function formatMoney(n: number, currency: string | null | undefined): string {
  const c = currency || "EUR";
  return new Intl.NumberFormat("sk-SK", {
    style: "currency",
    currency: c,
    maximumFractionDigits: 0,
  }).format(n);
}

function breakdownForDimension(
  data: MarketingPayload,
  dim: DimensionKey
): BreakdownRow[] {
  if (dim === "medium") return data.byMedium ?? [];
  if (dim === "campaign") return data.byCampaign ?? [];
  return data.bySource ?? [];
}

export default function MarketingClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const rangeFromUrl = parseRangeParam(searchParams.get("range"));
  const [range, setRange] = useState<RangeKey>(rangeFromUrl);

  const dimFromUrl = parseDimensionParam(searchParams.get("dim"));
  const [dimension, setDimension] = useState<DimensionKey>(dimFromUrl);

  useEffect(() => setRange(rangeFromUrl), [rangeFromUrl]);
  useEffect(() => setDimension(dimFromUrl), [dimFromUrl]);

  const [data, setData] = useState<MarketingPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [rangeMenuOpen, setRangeMenuOpen] = useState(false);
  const rangeMenuRef = useRef<HTMLDivElement>(null);
  const [dimMenuOpen, setDimMenuOpen] = useState(false);
  const dimMenuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!dimMenuOpen) return;
    const close = () => setDimMenuOpen(false);
    const onDown = (e: MouseEvent) => {
      if (dimMenuRef.current?.contains(e.target as Node)) return;
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
  }, [dimMenuOpen]);

  const load = useCallback(async (r: RangeKey) => {
    setLoading(true);
    setErr(null);
    try {
      const q = `?range=${encodeURIComponent(r)}&_=${Date.now()}`;
      const res = await fetch(`/api/marketing${q}`, { credentials: "same-origin" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as MarketingPayload;
      setData(json);
    } catch (e) {
      setData(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [load, range]);

  const setRangeInUrl = (next: RangeKey) => {
    setRange(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const setDimensionInUrl = (next: DimensionKey) => {
    setDimension(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "source") params.delete("dim");
    else params.set("dim", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const rows = useMemo(
    () => (data ? breakdownForDimension(data, dimension) : []),
    [data, dimension]
  );

  const pieData: ChartData<"pie"> | null = useMemo(() => {
    if (!rows.length) return null;
    return {
      labels: rows.map((r) =>
        r.label.length > 28 ? `${r.label.slice(0, 26)}…` : r.label
      ),
      datasets: [
        {
          data: rows.map((r) => Number(r.revenue)),
          backgroundColor: rows.map(
            (_, i) => PIE_COLORS[i % PIE_COLORS.length]
          ),
          borderColor: TEXT,
          borderWidth: 1,
        },
      ],
    };
  }, [rows]);

  const pieOptions: ChartOptions<"pie"> = {
    responsive: true,
    maintainAspectRatio: true,
    aspectRatio: 1.15,
    plugins: {
      legend: {
        position: "bottom",
        labels: {
          color: TEXT,
          font: { family: "DM Sans, sans-serif", size: 11 },
          padding: 10,
          boxWidth: 12,
        },
      },
      tooltip: {
        callbacks: {
          label(ctx) {
            const row = rows[ctx.dataIndex];
            if (!row) return "";
            return [
              `${row.label}`,
              `Tržby: ${formatMoney(row.revenue, data?.kpis.currency)} (${row.pct_revenue} %)`,
              `Objednávky: ${row.orders} (${row.pct_orders} %)`,
            ];
          },
        },
      },
    },
  };

  const periodLabel = data?.meta
    ? `${data.meta.from} – ${data.meta.to}`
    : RANGE_LABELS[range];

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__inner">
          <HeaderBrand />
          <div className="app-header__tools">
            <HeaderSectionSelect />
            <div className="period-filter" ref={rangeMenuRef}>
              <button
                type="button"
                className="period-filter__trigger"
                onClick={() => setRangeMenuOpen((o) => !o)}
                aria-expanded={rangeMenuOpen}
                aria-haspopup="listbox"
              >
                <span>{RANGE_LABELS[range]}</span>
                <span className="period-filter__chev" aria-hidden>
                  ▾
                </span>
              </button>
              {rangeMenuOpen ? (
                <ul className="period-filter__menu" role="listbox">
                  {RANGE_ORDER.map((v) => (
                    <li key={v}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={v === range}
                        className={
                          v === range
                            ? "period-filter__option is-active"
                            : "period-filter__option"
                        }
                        onClick={() => {
                          setRangeInUrl(v);
                          setRangeMenuOpen(false);
                        }}
                      >
                        {v === range ? "✓ " : ""}
                        {RANGE_LABELS[v]}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="period-filter" ref={dimMenuRef}>
              <button
                type="button"
                className="period-filter__trigger"
                onClick={() => setDimMenuOpen((o) => !o)}
                aria-expanded={dimMenuOpen}
                aria-haspopup="listbox"
              >
                <span>{DIMENSION_LABELS[dimension]}</span>
                <span className="period-filter__chev" aria-hidden>
                  ▾
                </span>
              </button>
              {dimMenuOpen ? (
                <ul className="period-filter__menu" role="listbox">
                  {(["source", "medium", "campaign"] as const).map((v) => (
                    <li key={v}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={v === dimension}
                        className={
                          v === dimension
                            ? "period-filter__option is-active"
                            : "period-filter__option"
                        }
                        onClick={() => {
                          setDimensionInUrl(v);
                          setDimMenuOpen(false);
                        }}
                      >
                        {v === dimension ? "✓ " : ""}
                        {DIMENSION_LABELS[v]}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <main className="main-wrap">
        {loading && !data ? (
          <p className="msg">Načítavam marketing…</p>
        ) : null}
        {err ? (
          <p className="msg msg--error" role="alert">
            {err}
          </p>
        ) : null}

        {data ? (
          <>
            <p className="dashboard-period-hint">
              Produktové objednávky (paid) · obdobie {periodLabel}
            </p>

            <section className="kpi-section kpi-section--secondary">
              <div className="kpi-card">
                <div className="kpi-card__label">Objednávky</div>
                <div className="kpi-card__value">{data.kpis.orders}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-card__label">Tržby (produktové riadky)</div>
                <div className="kpi-card__value">
                  {formatMoney(data.kpis.revenue, data.kpis.currency)}
                </div>
              </div>
              <div className="kpi-card">
                <div className="kpi-card__label">S UTM / journey</div>
                <div className="kpi-card__value">
                  {data.kpis.orders_with_utm}
                  {data.kpis.pct_orders_with_utm != null ? (
                    <span className="kpi-card__suffix">
                      {" "}
                      ({data.kpis.pct_orders_with_utm} %)
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="kpi-card">
                <div className="kpi-card__label">Bez UTM</div>
                <div className="kpi-card__value">
                  {data.kpis.orders_without_utm}
                </div>
              </div>
            </section>

            <section className="charts-row charts-row--marketing">
              <div className="chart-card">
                <h2>
                  Podiel tržieb podľa {DIMENSION_LABELS[dimension].toLowerCase()}
                </h2>
                {pieData ? (
                  <div className="marketing-pie-wrap">
                    <Pie data={pieData} options={pieOptions} />
                  </div>
                ) : (
                  <p className="chart-card__subtitle">Žiadne dáta v tomto okne.</p>
                )}
              </div>
              <div className="chart-card">
                <h2>Zoznam — {DIMENSION_LABELS[dimension]}</h2>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Kanál</th>
                        <th className="num">Obj.</th>
                        <th className="num">Tržby</th>
                        <th className="num">% obj.</th>
                        <th className="num">% tržby</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.label}>
                          <td>{r.label}</td>
                          <td className="num">{r.orders}</td>
                          <td className="num">
                            {formatMoney(r.revenue, data.kpis.currency)}
                          </td>
                          <td className="num">{r.pct_orders} %</td>
                          <td className="num">{r.pct_revenue} %</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section className="chart-card chart-card--marketing-orders">
              <h2>Objednávky s UTM (top 50 podľa tržieb)</h2>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Objednávka</th>
                      <th>Dátum</th>
                      <th className="num">Tržby</th>
                      <th>Zdroj</th>
                      <th>Medium</th>
                      <th>Kampaň</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.recentOrders ?? []).map((o) => (
                      <tr key={o.id}>
                        <td>{o.name}</td>
                        <td>{o.created_at}</td>
                        <td className="num">
                          {formatMoney(o.revenue, o.currency)}
                        </td>
                        <td title={o.utm_source ?? undefined}>
                          {o.channel_source}
                        </td>
                        <td>{o.utm_medium?.trim() || "—"}</td>
                        <td>{o.utm_campaign?.trim() || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
