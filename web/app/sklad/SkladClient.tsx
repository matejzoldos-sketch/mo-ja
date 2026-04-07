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
      <header className="site-header">
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
            <code>008_inventory_dashboard_consumption.sql</code>.
          </p>
        )}
        {!loading && !err && rows && (
          <>
            <section className="chart-card chart-card--sku-ytd sklad-chart-section">
              <h2>
                Vývoj skladu podľa SKU (od 1. 1.{" "}
                {stockChartYtd?.year ?? new Date().getFullYear()})
              </h2>
              <p className="chart-card__subtitle">
                Súčet dostupných kusov na všetkých lokáciách; po nasadení migrácie
                007 sa pri každom synci inventára uloží snímka. Graf ukazuje max. 10
                SKU s najvyšším aktuálnym stavom; medzi snímkami sa hodnota drží
                (posledná známa).
              </p>
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
              <p className="chart-card__subtitle">
                Priemerná denná spotreba YTD = predané kusy (paid / čiastočne) od 1. 1.
                delené počtom dní v roku až po dnes. Predaj sa páruje podľa inventory item ID
                (vrátane ID v <code>raw_json</code> riadku), inak podľa SKU / variant SKU / názov
                (normalizované +). V appke Shopify musí byť scope{" "}
                <strong>read_all_orders</strong>, inak API vráti len objednávky približne za
                posledných 60 dní — tabuľka potom nemá celý kalendárny rok. Spusti{" "}
                <code>sync_shopify.py --ytd</code> po migrácii DB. Odhad dní = dostupné ÷ tento
                priemer; pri nulovom predaji prázdne.
              </p>
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
