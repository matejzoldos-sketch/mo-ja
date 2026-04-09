"use client";

import { useCallback, useEffect, useState } from "react";
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
import {
  buildStockHistoryChart,
  stockHistoryChartOptions,
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
  estimated_days_of_stock: number | null;
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

function formatDaysStock(n: number | null | undefined) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const x = Number(n);
  if (x === 0) return "0";
  return new Intl.NumberFormat("sk-SK", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(x);
}

export default function SkladClient() {
  const [rows, setRows] = useState<InvRow[] | null>(null);
  const [stockChartYtd, setStockChartYtd] = useState<StockChartYtd | null>(
    null
  );
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/inventory");
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || `HTTP ${res.status}`);
        setRows(null);
        setStockChartYtd(null);
        return;
      }
      if (Array.isArray(json)) {
        setRows(json as InvRow[]);
        setStockChartYtd(null);
        return;
      }
      setRows((json.levels as InvRow[]) ?? []);
      setStockChartYtd((json.stockChartYtd as StockChartYtd) ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Fetch failed");
      setRows(null);
      setStockChartYtd(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stockLineData = stockChartYtd
    ? buildStockHistoryChart(stockChartYtd)
    : null;

  return (
    <>
      <header className="site-header site-header--sklad">
        <div className="site-header__inner">
          <HeaderBrand />
          <div className="site-header__dropdowns">
            <HeaderSectionSelect />
          </div>
        </div>
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
            <code>020_inventory_stock_chart_skip_empty_sku.sql</code>.
          </p>
        )}
        {!loading && !err && rows && (
          <>
            <section className="chart-card chart-card--sku-ytd sklad-chart-section">
              <h2>
                Vývoj skladu podľa SKU (od 7. 4.{" "}
                {stockChartYtd?.year ?? new Date().getFullYear()})
              </h2>
              {stockLineData ? (
                <div className="sku-ytd-chart-wrap">
                  <Line
                    data={stockLineData}
                    options={stockHistoryChartOptions}
                  />
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
                        <th>Odhad dní zásoby</th>
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
                            {formatDaysStock(
                              r.estimated_days_of_stock ?? null
                            )}
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
