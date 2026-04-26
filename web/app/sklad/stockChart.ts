import type { ChartData, ChartOptions } from "chart.js";

export type StockChartYtd = {
  year: number;
  from: string;
  to: string;
  skuOrder: string[];
  points: {
    date: string;
    sku: string;
    stock: number;
    /** Po migr. 041: zobrazený názov (môže sa líšiť od sku). */
    product_title?: string;
  }[];
};

function displayTitleForSkuSeries(
  s: StockChartYtd,
  skuKey: string
): string {
  const row = s.points.find((p) => p.sku === skuKey);
  const t = row?.product_title?.trim();
  return t || skuKey;
}

/** Sklad chart: first useful snapshots from ~7 Apr — clamp if RPC still returns Jan 1 / 1 Apr. */
function effectiveChartFromIso(s: StockChartYtd): string {
  const y = s.year ?? new Date().getFullYear();
  const april7 = `${y}-04-07`;
  if (!s.from || s.from < april7) return april7;
  return s.from;
}

function enumerateInclusiveDays(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  const cur = new Date(Date.UTC(fy, (fm || 1) - 1, fd || 1));
  const end = new Date(Date.UTC(ty, (tm || 1) - 1, td || 1));
  if (cur.getTime() > end.getTime()) return [];
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

/** Carry last reading forward; days before first snapshot = null (not 0 — so Y-scale is not pinned to zero). */
function forwardFillStock(
  days: string[],
  byDay: Map<string, number>
): (number | null)[] {
  let last = 0;
  let seen = false;
  return days.map((d) => {
    if (byDay.has(d)) {
      last = byDay.get(d)!;
      seen = true;
      return last;
    }
    return seen ? last : null;
  });
}

export function buildStockHistoryChart(
  s: StockChartYtd | undefined
): ChartData<"line"> | null {
  if (!s?.skuOrder?.length) return null;
  const fromIso = effectiveChartFromIso(s);
  const days = enumerateInclusiveDays(fromIso, s.to);
  if (days.length === 0) return null;
  const n = s.skuOrder.length;
  const datasets: ChartData<"line">["datasets"] = [];
  for (let i = 0; i < s.skuOrder.length; i++) {
    const sku = s.skuOrder[i];
    const rawLabel = displayTitleForSkuSeries(s, sku);
    const label = rawLabel.length > 40 ? `${rawLabel.slice(0, 38)}…` : rawLabel;
    const byDay = new Map<string, number>();
    for (const p of s.points) {
      if (p.sku === sku) byDay.set(p.date, Number(p.stock));
    }
    const color = skuLineColor(i, n);
    datasets.push({
      label,
      data: forwardFillStock(days, byDay),
      borderColor: color,
      backgroundColor: "transparent",
      fill: false,
      tension: 0.2,
      spanGaps: true,
      pointRadius: 0,
      pointHoverRadius: 4,
      borderWidth: 2,
    });
  }
  return { labels: days, datasets };
}

const TEXT = "#333333";
const GRID = "rgba(51,51,51,0.08)";

const Y_PADDING_RATIO = 0.08;
/** Tighter padding when each SKU has its own chart — movement reads larger. */
const Y_PADDING_RATIO_PER_SKU = 0.04;

function numericSeriesValues(data: ChartData<"line">): number[] {
  const out: number[] = [];
  for (const ds of data.datasets) {
    const row = ds.data;
    if (!Array.isArray(row)) continue;
    for (const v of row) {
      if (typeof v === "number" && Number.isFinite(v)) out.push(v);
    }
  }
  return out;
}

/** Y range from data + padding so small day-to-day changes are visible (not locked to 0..max). */
function yExtentFromData(
  data: ChartData<"line">,
  paddingRatio: number = Y_PADDING_RATIO
): { min: number; max: number } {
  const vals = numericSeriesValues(data);
  if (vals.length === 0) return { min: 0, max: 1 };
  let minV = Math.min(...vals);
  let maxV = Math.max(...vals);
  if (minV === maxV) {
    const pad = Math.max(Math.abs(minV) * 0.02, 1);
    return {
      min: Math.max(0, minV - pad),
      max: maxV + pad,
    };
  }
  const span = maxV - minV;
  const pad = Math.max(span * paddingRatio, 1);
  return {
    min: Math.max(0, minV - pad),
    max: maxV + pad,
  };
}

function createStockLineChartOptions(
  yMin: number,
  yMax: number,
  showLegend: boolean
): ChartOptions<"line"> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: showLegend,
        position: "bottom",
        labels: {
          color: TEXT,
          font: { family: "Manrope", size: 11 },
          boxWidth: 12,
          padding: 10,
          usePointStyle: true,
          pointStyle: "line",
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
        beginAtZero: false,
        min: yMin,
        max: yMax,
      },
    },
    interaction: {
      mode: "nearest",
      axis: "x",
      intersect: false,
    },
  };
}

export function buildStockHistoryChartOptions(
  data: ChartData<"line">
): ChartOptions<"line"> {
  const { min: yMin, max: yMax } = yExtentFromData(data);
  return createStockLineChartOptions(yMin, yMax, true);
}

export type StockSkuPanel = {
  skuLabel: string;
  data: ChartData<"line">;
  options: ChartOptions<"line">;
};

/** One chart per SKU, each with its own Y scale (small moves stay visible vs one shared axis). */
export function buildStockSkuPanels(
  s: StockChartYtd | undefined
): StockSkuPanel[] | null {
  if (!s?.skuOrder?.length) return null;
  const fromIso = effectiveChartFromIso(s);
  const days = enumerateInclusiveDays(fromIso, s.to);
  if (days.length === 0) return null;
  const n = s.skuOrder.length;
  const panels: StockSkuPanel[] = [];
  for (let i = 0; i < n; i++) {
    const sku = s.skuOrder[i];
    const rawLabel = displayTitleForSkuSeries(s, sku);
    const label = rawLabel.length > 40 ? `${rawLabel.slice(0, 38)}…` : rawLabel;
    const byDay = new Map<string, number>();
    for (const p of s.points) {
      if (p.sku === sku) byDay.set(p.date, Number(p.stock));
    }
    const color = skuLineColor(i, n);
    const data: ChartData<"line"> = {
      labels: days,
      datasets: [
        {
          label: "Ks na sklade",
          data: forwardFillStock(days, byDay),
          borderColor: color,
          backgroundColor: "transparent",
          fill: false,
          tension: 0.2,
          spanGaps: true,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 2,
        },
      ],
    };
    const { min: yMin, max: yMax } = yExtentFromData(
      data,
      Y_PADDING_RATIO_PER_SKU
    );
    panels.push({
      skuLabel: label,
      data,
      options: createStockLineChartOptions(yMin, yMax, false),
    });
  }
  return panels;
}
