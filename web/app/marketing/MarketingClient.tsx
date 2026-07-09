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
import { PeriodFilterMenu } from "../components/PeriodFilterMenu";
import {
  buildMarketingMarkdown,
  downloadMarketingMarkdown,
} from "@/lib/marketingMarkdownExport";
import {
  periodFilterApiQuery,
  periodFilterLabel,
  periodFilterNeedsUrlNormalize,
  periodFilterToSearchParams,
  parsePeriodFilter,
  type PeriodFilter,
} from "@/lib/dashboardPeriodFilter";

ChartJS.register(ArcElement, Tooltip, Legend);

type DimensionKey = "source" | "medium" | "campaign";

type BreakdownRow = {
  label: string;
  orders: number;
  revenue: number;
  pct_orders: number;
  pct_revenue: number;
};

type MarketingPayload = {
  meta: { range: string; from: string; to: string; month?: string | null };
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

function normalizeMarketingPayload(raw: unknown): MarketingPayload | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const kpisRaw = o.kpis;
  if (kpisRaw == null || typeof kpisRaw !== "object" || Array.isArray(kpisRaw)) {
    return null;
  }
  const k = kpisRaw as Record<string, unknown>;
  const metaRaw = o.meta;
  const meta =
    metaRaw != null && typeof metaRaw === "object" && !Array.isArray(metaRaw)
      ? (metaRaw as MarketingPayload["meta"])
      : { range: "90d", from: "", to: "" };

  const asRows = (v: unknown): BreakdownRow[] =>
    Array.isArray(v) ? (v as BreakdownRow[]) : [];

  return {
    meta,
    kpis: {
      orders: Number(k.orders) || 0,
      orders_with_utm: Number(k.orders_with_utm) || 0,
      orders_without_utm: Number(k.orders_without_utm) || 0,
      revenue: Number(k.revenue) || 0,
      currency: typeof k.currency === "string" ? k.currency : "EUR",
      pct_orders_with_utm:
        k.pct_orders_with_utm == null ? null : Number(k.pct_orders_with_utm),
    },
    bySource: asRows(o.bySource),
    byMedium: asRows(o.byMedium),
    byCampaign: asRows(o.byCampaign),
    recentOrders: Array.isArray(o.recentOrders)
      ? (o.recentOrders as MarketingPayload["recentOrders"])
      : [],
  };
}

export default function MarketingClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const rangeRaw = searchParams.get("range");
  const monthRaw = searchParams.get("month");
  const yearRaw = searchParams.get("year");
  const period = useMemo(
    () => parsePeriodFilter(rangeRaw, monthRaw, yearRaw, { defaultRange: "90d" }),
    [rangeRaw, monthRaw, yearRaw]
  );

  const dimFromUrl = parseDimensionParam(searchParams.get("dim"));
  const [dimension, setDimension] = useState<DimensionKey>(dimFromUrl);

  useEffect(() => setDimension(dimFromUrl), [dimFromUrl]);

  const [data, setData] = useState<MarketingPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [dimMenuOpen, setDimMenuOpen] = useState(false);
  const dimMenuRef = useRef<HTMLDivElement>(null);

  const [pdfExporting, setPdfExporting] = useState(false);
  const pdfExportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const rangeRaw = searchParams.get("range");
    const monthRaw = searchParams.get("month");
    const yearRaw = searchParams.get("year");
    if (!periodFilterNeedsUrlNormalize(rangeRaw, monthRaw, yearRaw)) {
      return;
    }
    const next = parsePeriodFilter(rangeRaw, monthRaw, yearRaw, {
      defaultRange: "90d",
    });
    const params = periodFilterToSearchParams(next, searchParams);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, pathname, router]);

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

  const load = useCallback(async (p: PeriodFilter) => {
    setLoading(true);
    setErr(null);
    try {
      const q = `?${periodFilterApiQuery(p)}&_=${Date.now()}`;
      const res = await fetch(`/api/marketing${q}`, { credentials: "same-origin" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json: unknown = await res.json();
      const normalized = normalizeMarketingPayload(json);
      if (!normalized) {
        throw new Error("Neplatná odpoveď marketing API");
      }
      setData(normalized);
    } catch (e) {
      setData(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period.range, period.month]);

  const setPeriodInUrl = (next: PeriodFilter) => {
    const params = periodFilterToSearchParams(next, searchParams);
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

  const chartRows = useMemo(
    () => rows.filter((r) => Number(r.revenue) > 0),
    [rows]
  );

  const pieData: ChartData<"pie"> | null = useMemo(() => {
    if (!chartRows.length) return null;
    return {
      labels: chartRows.map((r) => {
        const label = r.label ?? "—";
        return label.length > 28 ? `${label.slice(0, 26)}…` : label;
      }),
      datasets: [
        {
          data: chartRows.map((r) => Number(r.revenue)),
          backgroundColor: chartRows.map(
            (_, i) => PIE_COLORS[i % PIE_COLORS.length]
          ),
          borderColor: TEXT,
          borderWidth: 1,
        },
      ],
    };
  }, [chartRows]);

  const [compactCharts, setCompactCharts] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 520px)");
    const update = () => setCompactCharts(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const pieOptions: ChartOptions<"pie"> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: compactCharts ? 1 : 1.15,
      plugins: {
        legend: {
          display: !compactCharts,
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
              const row = chartRows[ctx.dataIndex];
              if (!row) return "";
              return [
                `${row.label ?? "—"}`,
                `Tržby: ${formatMoney(row.revenue, data?.kpis.currency)} (${row.pct_revenue} %)`,
                `Objednávky: ${row.orders} (${row.pct_orders} %)`,
              ];
            },
          },
        },
      },
    }),
    [chartRows, compactCharts, data?.kpis.currency]
  );

  const periodLabel = data?.meta
    ? `${data.meta.from} – ${data.meta.to}`
    : periodFilterLabel(period);

  const downloadMarketingMd = useCallback(() => {
    if (!data) return;
    const breakdownRows = breakdownForDimension(data, dimension);
    const from = data.meta.from.replace(/\s/g, "");
    const to = data.meta.to.replace(/\s/g, "");

    const md = buildMarketingMarkdown({
      range: period.range,
      rangeLabel: periodFilterLabel(period),
      periodLabel,
      dimension,
      dimensionLabel: DIMENSION_LABELS[dimension],
      from: data.meta.from,
      to: data.meta.to,
      kpis: data.kpis,
      breakdownRows,
      currency: data.kpis.currency,
    });

    const periodSlug =
      period.range === "month"
        ? `month-${period.month ?? "current"}`
        : period.range === "year"
          ? `year-${period.year ?? "current"}`
          : period.range;
    downloadMarketingMarkdown(
      md,
      `marketing-${periodSlug}-${dimension}_${from}_${to}.md`
    );
  }, [data, period, dimension, periodLabel]);

  const downloadMarketingPdf = useCallback(async () => {
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
      const periodSlug =
        period.range === "month"
          ? `month-${period.month ?? "current"}`
          : period.range === "year"
            ? `year-${period.year ?? "current"}`
            : period.range;
      pdf.save(`marketing-${periodSlug}-${dimension}_${from}_${to}.pdf`);
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
  }, [data, period, dimension]);

  return (
    <>
      <header className="site-header site-header--sklad">
        <div className="site-header__inner">
          <HeaderBrand />
          <div className="site-toolbar__filters site-toolbar__filters--under-brand">
            <HeaderSectionSelect />
          </div>
        </div>
        <div className="site-toolbar">
          <div className="site-toolbar__filters">
            <PeriodFilterMenu period={period} onChange={setPeriodInUrl} />
            <div className="period-filter period-filter--kpi-product" ref={dimMenuRef}>
              <button
                type="button"
                className="period-filter__select period-filter__select--range-trigger"
                aria-expanded={dimMenuOpen}
                aria-haspopup="listbox"
                aria-label="Rozmer UTM"
                onClick={() => setDimMenuOpen((o) => !o)}
              >
                <span>{DIMENSION_LABELS[dimension]}</span>
                <span className="period-filter__chevron" aria-hidden>
                  ▼
                </span>
              </button>
              {dimMenuOpen ? (
                <ul
                  className="period-filter__range-list"
                  role="listbox"
                  aria-label="Rozmer UTM"
                >
                  {(["source", "medium", "campaign"] as const).map((v) => (
                    <li key={v} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected={v === dimension}
                        className={
                          v === dimension
                            ? "period-filter__range-option is-selected"
                            : "period-filter__range-option"
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
          {data && !loading && !err ? (
            <div className="site-toolbar__actions">
              <button
                type="button"
                className="dashboard-export-btn"
                onClick={downloadMarketingMd}
              >
                Stiahnuť MD
              </button>
              <button
                type="button"
                className="dashboard-export-btn dashboard-export-btn--accent"
                disabled={pdfExporting}
                aria-busy={pdfExporting}
                onClick={() => void downloadMarketingPdf()}
              >
                {pdfExporting ? "Generujem PDF…" : "Stiahnuť PDF"}
              </button>
            </div>
          ) : null}
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
          <div className="dashboard-pdf-root" ref={pdfExportRef}>
            <p className="dashboard-period-hint">
              Produktové objednávky (paid) · obdobie {periodLabel}
            </p>

            <section className="kpi-section">
              <div className="kpi-grid kpi-grid--secondary">
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
              </div>
            </section>

            <section className="charts-row charts-row--marketing">
              <div className="chart-card chart-card--marketing-pie">
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
          </div>
        ) : null}
      </main>
    </>
  );
}
