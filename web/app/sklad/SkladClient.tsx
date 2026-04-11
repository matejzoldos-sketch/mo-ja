"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { HeaderBrand, HeaderSectionSelect } from "../components/HeaderNav";
import { formatLastSyncDisplay } from "@/lib/formatLastSync";
import {
  buildStockSkuPanels,
  type StockChartYtd,
} from "./stockChart";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

type InvRow = {
  inventory_item_id: number;
  location_id: number;
  location_name: string | null;
  sku: string;
  available: number;
  updated_at: string | null;
  fetched_at: string | null;
  avg_daily_units_sold_ytd: number | null;
  /** Text YYYY-MM-DD z RPC (po migr. 023); pri absencii vieme dopočítať z estimated_days_of_stock. */
  estimated_stockout_date?: string | null;
  estimated_days_of_stock?: number | null;
};

function formatWhen(iso: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat("sk-SK", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(d);
  } catch {
    return iso;
  }
}

function formatAvgDaily(n: number | null | undefined) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return new Intl.NumberFormat("sk-SK", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(Number(n));
}

/** Hodnota z JSON môže byť reťazec, ISO s časom, alebo (zriedka) iný typ. */
function formatStockoutDate(raw: unknown): string {
  if (raw == null) return "—";
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return "—";
    return new Intl.DateTimeFormat("sk-SK", {
      dateStyle: "medium",
      timeZone: "Europe/Bratislava",
    }).format(raw);
  }
  const s = String(raw).trim();
  if (!s || s === "null") return "—";
  const ymd = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    const y = Number(ymd.slice(0, 4));
    const mo = Number(ymd.slice(5, 7));
    const d = Number(ymd.slice(8, 10));
    if (y >= 1 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      try {
        return new Intl.DateTimeFormat("sk-SK", { dateStyle: "medium" }).format(
          new Date(y, mo - 1, d)
        );
      } catch {
        return "—";
      }
    }
  }
  const ms = Date.parse(s);
  if (!Number.isNaN(ms)) {
    return new Intl.DateTimeFormat("sk-SK", {
      dateStyle: "medium",
      timeZone: "Europe/Bratislava",
    }).format(new Date(ms));
  }
  return "—";
}

/** Dátum z API alebo záloha z počtu dní (Bratislava „dnes“ + zaokr. dni). */
function formatStockoutForRow(r: InvRow): string {
  const fromApi = formatStockoutDate(r.estimated_stockout_date);
  if (fromApi !== "—") return fromApi;
  const days = r.estimated_days_of_stock;
  if (days == null || Number.isNaN(Number(days))) return "—";
  const n = Number(days);
  if (!Number.isFinite(n) || n < 0) return "—";
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bratislava",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value) - 1;
  const d = Number(parts.find((p) => p.type === "day")?.value);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return "—";
  try {
    return new Intl.DateTimeFormat("sk-SK", { dateStyle: "medium" }).format(
      new Date(y, m, d + Math.round(n))
    );
  } catch {
    return "—";
  }
}

export default function SkladClient() {
  const [rows, setRows] = useState<InvRow[] | null>(null);
  const [stockChartYtd, setStockChartYtd] = useState<StockChartYtd | null>(
    null
  );
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/inventory", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || `HTTP ${res.status}`);
        setRows(null);
        setStockChartYtd(null);
        setLastSyncAt(null);
        return;
      }
      if (Array.isArray(json)) {
        setRows(json as InvRow[]);
        setStockChartYtd(null);
        setLastSyncAt(null);
        return;
      }
      setRows((json.levels as InvRow[]) ?? []);
      setStockChartYtd((json.stockChartYtd as StockChartYtd) ?? null);
      setLastSyncAt(
        typeof json.lastSyncAt === "string" && json.lastSyncAt !== ""
          ? json.lastSyncAt
          : null
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Fetch failed");
      setRows(null);
      setStockChartYtd(null);
      setLastSyncAt(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stockSkuPanels = useMemo(
    () => (stockChartYtd ? buildStockSkuPanels(stockChartYtd) : null),
    [stockChartYtd]
  );

  return (
    <>
      <header className="site-header site-header--sklad">
        <div className="site-header__inner">
          <HeaderBrand />
          <div className="site-header__dropdowns">
            <HeaderSectionSelect />
          </div>
        </div>
        {lastSyncAt != null && (
          <p className="site-header__sync-meta">
            Posledný sync dát: {formatLastSyncDisplay(lastSyncAt)}
          </p>
        )}
      </header>

      <main className="main-wrap">
        {loading && <p className="msg">Načítavam…</p>}
        {err && !loading && (
          <p className="msg msg-error">
            {err}{" "}
            Skontroluj env a migrácie <code>005_inventory_dashboard_rpc.sql</code>,{" "}
            <code>007_inventory_snapshots.sql</code>,{" "}
            <code>008_inventory_dashboard_consumption.sql</code>,{" "}
            <code>019_inventory_dashboard_skip_empty_sku.sql</code>,{" "}
            <code>020_inventory_stock_chart_skip_empty_sku.sql</code>,{" "}
            <code>021_inventory_skip_empty_sku_robust.sql</code>,{" "}
            <code>022_inventory_estimated_stockout_date.sql</code>,{" "}
            <code>023_inventory_stockout_date_to_char.sql</code>.
          </p>
        )}
        {!loading && !err && rows && (
          <>
            <section className="chart-card chart-card--sku-ytd sklad-chart-section">
              <h2>
                Vývoj skladu podľa SKU (od 7. 4.{" "}
                {stockChartYtd?.year ?? new Date().getFullYear()})
              </h2>
              <p className="chart-card__subtitle">
                Každé SKU má vlastnú os Y — menšie zmeny sú čitateľnejšie ako pri jednom
                spoločnom grafe.
              </p>
              {stockSkuPanels?.length ? (
                <div className="sku-ytd-panels">
                  {stockSkuPanels.map((panel, idx) => (
                    <div
                      key={`${panel.skuLabel}-${idx}`}
                      className="sku-ytd-panel"
                    >
                      <h3 className="sku-ytd-panel__title">{panel.skuLabel}</h3>
                      <div className="sku-ytd-panel__chart">
                        <Line data={panel.data} options={panel.options} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="msg">
                  Zatiaľ žiadne snapshoty — po prvom behu syncu s inventárom sa tu
                  začne plniť história.
                </p>
              )}
            </section>

            <section className="table-card">
              <h2>Aktuálny stav podľa lokácie a SKU</h2>
              {rows.length === 0 ? (
                <p className="msg">
                  Žiadne dáta o sklade. Spusti synchronizáciu s inventárom (
                  <code>sync_shopify.py</code> bez <code>--orders-only</code>).
                </p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Lokácia</th>
                        <th>SKU</th>
                        <th>Dostupné</th>
                        <th>Priem. denná spotreba YTD</th>
                        <th>Odhad dátumu vyčerpania zásob</th>
                        <th>Shopify updated</th>
                        <th>Sync</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr
                          key={`${r.inventory_item_id}-${r.location_id}`}
                        >
                          <td>{r.location_name || "—"}</td>
                          <td>{r.sku}</td>
                          <td>{r.available}</td>
                          <td>
                            {formatAvgDaily(
                              r.avg_daily_units_sold_ytd ?? null
                            )}
                          </td>
                          <td>
                            {formatStockoutForRow(r)}
                          </td>
                          <td>{formatWhen(r.updated_at)}</td>
                          <td>{formatWhen(r.fetched_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
