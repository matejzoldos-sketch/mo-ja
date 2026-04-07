import type { ChartData, ChartOptions } from "chart.js";

export type StockChartYtd = {
  year: number;
  from: string;
  to: string;
  skuOrder: string[];
  points: { date: string; sku: string; stock: number }[];
};

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

/** Carry last reading forward; days before first snapshot = 0. */
function forwardFillStock(
  days: string[],
  byDay: Map<string, number>
): number[] {
  let last = 0;
  let seen = false;
  return days.map((d) => {
    if (byDay.has(d)) {
      last = byDay.get(d)!;
      seen = true;
      return last;
    }
    return seen ? last : 0;
  });
}

export function buildStockHistoryChart(
  s: StockChartYtd | undefined
): ChartData<"line"> | null {
  if (!s?.skuOrder?.length) return null;
  const days = enumerateInclusiveDays(s.from, s.to);
  if (days.length === 0) return null;
  const n = s.skuOrder.length;
  const datasets: ChartData<"line">["datasets"] = [];
  for (let i = 0; i < s.skuOrder.length; i++) {
    const sku = s.skuOrder[i];
    const label = sku.length > 40 ? `${sku.slice(0, 38)}…` : sku;
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
      pointRadius: 0,
      pointHoverRadius: 4,
      borderWidth: 2,
    });
  }
  return { labels: days, datasets };
}

const TEXT = "#333333";
const GRID = "rgba(51,51,51,0.08)";

export const stockHistoryChartOptions: ChartOptions<"line"> = {
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
