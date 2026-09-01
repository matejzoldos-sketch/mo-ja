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
  isActiveSkladSku,
  skladSkuMeta,
  skladSkuStatusLabel,
} from "@/lib/skladSkuMeta";
import {
  computeRecommendedRunway,
  formatRunwayDays,
} from "@/lib/skladRunway";
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
  /** Názov z objednákových položiek (title), inak SKU — z RPC po migr. 041. */
  product_title?: string;
  available: number;
  updated_at: string | null;
  fetched_at: string | null;
  avg_daily_units_sold_ytd: number | null;
  /** Text YYYY-MM-DD z RPC (po migr. 023); pri absencii vieme dopočítať z estimated_days_of_stock. */
  estimated_stockout_date?: string | null;
  estimated_days_of_stock?: number | null;
  avg_daily_units_sold_30d?: number | null;
  units_sold_30d?: number | null;
  estimated_stockout_date_30d?: string | null;
};

type PhysicalRow = {
  month_key: string;
  product_key: string;
  product_label: string;
  stock_end: number;
  stock_in?: number | null;
  stock_out?: number | null;
  shopify_out?: number | null;
};

type PhysicalInventory = {
  latestMonthKey: string | null;
  rows: PhysicalRow[];
  importedAt: string | null;
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
  const [physical, setPhysical] = useState<PhysicalInventory | null>(null);
  const [stockChartYtd, setStockChartYtd] = useState<StockChartYtd | null>(
    null
  );
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeOnly, setActiveOnly] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/inventory?_=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || `HTTP ${res.status}`);
        setRows(null);
        setStockChartYtd(null);
        setPhysical(null);
        setLastSyncAt(null);
        return;
      }
      if (Array.isArray(json)) {
        setRows(json as InvRow[]);
        setStockChartYtd(null);
        setPhysical(null);
        setLastSyncAt(null);
        return;
      }
      setRows((json.levels as InvRow[]) ?? []);
      setStockChartYtd((json.stockChartYtd as StockChartYtd) ?? null);
      setPhysical((json.physical as PhysicalInventory) ?? null);
      setLastSyncAt(
        typeof json.lastSyncAt === "string" && json.lastSyncAt !== ""
          ? json.lastSyncAt
          : null
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Fetch failed");
      setRows(null);
      setStockChartYtd(null);
      setPhysical(null);
      setLastSyncAt(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  const stockSkuPanels = useMemo(
    () => (stockChartYtd ? buildStockSkuPanels(stockChartYtd) : null),
    [stockChartYtd]
  );

  const visibleRows = useMemo(() => {
    if (!rows) return [];
    if (!activeOnly) return rows;
    return rows.filter((r) => isActiveSkladSku(r.sku));
  }, [rows, activeOnly]);

  const physicalByKey = useMemo(() => {
    const m = new Map<string, PhysicalRow>();
    for (const r of physical?.rows ?? []) {
      m.set(r.product_key, r);
    }
    return m;
  }, [physical]);

  const recommendedRunway = useMemo(() => {
    if (!physical?.rows?.length || !rows?.length) return [];
    return computeRecommendedRunway(physical.rows, rows);
  }, [physical, rows]);

  const recommendedByProductKey = useMemo(() => {
    const m = new Map<string, (typeof recommendedRunway)[number]>();
    for (const r of recommendedRunway) {
      m.set(r.product_key, r);
    }
    return m;
  }, [recommendedRunway]);

  return (
    <>
      <header className="site-header site-header--sklad">
        <div className="site-header__inner">
          <HeaderBrand />
          <div className="site-toolbar__filters site-toolbar__filters--under-brand">
            <HeaderSectionSelect />
          </div>
        </div>
        {lastSyncAt != null && (
          <div className="site-header__meta">
            <p className="site-header__sync-meta">
              Posledný sync dát: {formatLastSyncDisplay(lastSyncAt)}
            </p>
          </div>
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
            <code>023_inventory_stockout_date_to_char.sql</code>,{" "}
            <code>041_dashboard_sku_units_title_first_inventory_product_labels.sql</code>,{" "}
            <code>042_inventory_product_title_eff_inv_and_match_key.sql</code>.
          </p>
        )}
        {!loading && !err && rows && (
          <>
            <section className="chart-card sklad-sources-note">
              <h2>Dva zdroje skladu</h2>
              <p className="chart-card__subtitle">
                <strong>Fyzický sklad (XLS Sklad_sumár)</strong> — Swiss Point,
                mesačný stav od účtovníctva. Aktualizuje sa importom z reportu.{" "}
                <strong>Shopify</strong> — denný sync pre e-shop a tempo predaja;
                nemusí sedieť s fyzickým stavom (Lazaretská, ručné úpravy v Shopify).
              </p>
            </section>

            {physical?.rows?.length ? (
              <section className="table-card">
                <h2>
                  Fyzický sklad Swiss Point
                  {physical.latestMonthKey
                    ? ` — stav k ${physical.latestMonthKey}`
                    : ""}
                </h2>
                <p className="chart-card__subtitle">
                  Z MO-JA report XLS (hárok Sklad_sumár). Import:{" "}
                  <code>python3 etl/import_sklad_xls.py</code>
                  {physical.importedAt
                    ? ` · naposledy ${formatWhen(physical.importedAt)}`
                    : ""}
                </p>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Produkt</th>
                        <th>Stav (ks)</th>
                        <th>Príjem / mesiac</th>
                        <th>Výdaj / mesiac</th>
                        <th>Výdaj Shopify / mesiac</th>
                        <th>Shopify SKU (orientačne)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {physical.rows.map((r) => {
                        const shopifySku =
                          r.product_key === "phase_plus_berry"
                            ? "PH+-B1-C-1"
                            : r.product_key === "phase_ananas"
                              ? "PH-B1-A"
                              : r.product_key === "phase_plus_citron"
                                ? "PH+-B1-C (vypredaný)"
                                : "—";
                        const shopifyRow = visibleRows.find(
                          (x) =>
                            skladSkuMeta(x.sku)?.physicalProductKey ===
                            r.product_key
                        );
                        return (
                          <tr key={r.product_key}>
                            <td>{r.product_label}</td>
                            <td>{r.stock_end}</td>
                            <td>{r.stock_in ?? "—"}</td>
                            <td>{r.stock_out ?? "—"}</td>
                            <td>{r.shopify_out ?? "—"}</td>
                            <td>
                              {shopifySku}
                              {shopifyRow != null && (
                                <>
                                  {" "}
                                  · Shopify {shopifyRow.available} ks
                                </>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : (
              <section className="chart-card">
                <p className="msg">
                  Fyzický sklad zatiaľ nie je naimportovaný. Spusti{" "}
                  <code>python3 etl/import_sklad_xls.py --xlsx-path docs/MO-JA_report_….xlsx</code>{" "}
                  po <code>supabase db push</code> (migrácia{" "}
                  <code>095_physical_inventory_monthly.sql</code>).
                </p>
              </section>
            )}

            {recommendedRunway.length > 0 ? (
              <section className="table-card sklad-runway-card">
                <h2>Odporúčaný runway</h2>
                <p className="chart-card__subtitle">
                  Fyzický stav z XLS (Swiss Point) ÷ tempo predaja zo Shopify
                  (posledných 30 dní). Presnejší odhad než čistý Shopify sklad —
                  najmä keď e-shop a fyzický sklad nesedia.
                </p>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Produkt</th>
                        <th>Fyzický stav (XLS)</th>
                        <th>Predaj / deň (30 dní)</th>
                        <th>Runway</th>
                        <th>Do kedy cca.</th>
                        <th>Shopify sklad (porovnanie)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recommendedRunway.map((r) => {
                        const isCritical =
                          r.days_runway != null &&
                          r.days_runway > 0 &&
                          r.days_runway <= 45 &&
                          r.sales_per_day_30d != null &&
                          r.sales_per_day_30d > 0;
                        const isSoldOut =
                          r.physical_stock <= 0 ||
                          (r.days_runway != null && r.days_runway <= 0);
                        return (
                          <tr
                            key={r.product_key}
                            className={
                              isSoldOut
                                ? "sklad-runway-row--soldout"
                                : isCritical
                                  ? "sklad-runway-row--critical"
                                  : undefined
                            }
                          >
                            <td>{r.product_label}</td>
                            <td>
                              {r.physical_stock} ks
                              <span className="sklad-row__phys">
                                {" "}
                                ({r.physical_month_key})
                              </span>
                            </td>
                            <td>
                              {r.sales_per_day_30d != null &&
                              r.sales_per_day_30d > 0 ? (
                                <>
                                  {formatAvgDaily(r.sales_per_day_30d)}
                                  {r.units_sold_30d != null
                                    ? ` (${r.units_sold_30d} ks)`
                                    : ""}
                                  {r.shopify_sku ? (
                                    <span className="sklad-row__phys">
                                      {" "}
                                      · {r.shopify_sku}
                                    </span>
                                  ) : null}
                                </>
                              ) : (
                                "bez predaja"
                              )}
                            </td>
                            <td>{formatRunwayDays(r.days_runway)}</td>
                            <td>{formatStockoutDate(r.stockout_date)}</td>
                            <td>
                              {r.shopify_available != null
                                ? `${r.shopify_available} ks`
                                : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            <section className="chart-card chart-card--sku-ytd sklad-chart-section">
              <h2>
                Vývoj skladu podľa produktu (od 7. 4.{" "}
                {stockChartYtd?.year ?? new Date().getFullYear()})
              </h2>
              <p className="chart-card__subtitle">
                Jeden graf na produkt — aliasy SKU (napr. PHASE / MOJA Phase) sa sčítajú.
                Každý produkt má vlastnú os Y, aby boli menšie zmeny čitateľné.
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
              <h2>Shopify — e-shop sklad</h2>
              <p className="chart-card__subtitle">
                Runway „30 dní“ počíta z predaja za posledný mesiac (presnejšie
                pri zmene SKU). YTD stĺpec môže byť optimistickejší.
              </p>
              <label className="sklad-filter-active">
                <input
                  type="checkbox"
                  checked={activeOnly}
                  onChange={(e) => setActiveOnly(e.target.checked)}
                />{" "}
                Len aktívne SKU v predaji
              </label>
              {visibleRows.length === 0 ? (
                <p className="msg">
                  Žiadne dáta o sklade. Spusti synchronizáciu s inventárom (
                  <code>sync_shopify.py</code> bez <code>--orders-only</code>).
                </p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Stav SKU</th>
                        <th>Lokácia</th>
                        <th>Produkt</th>
                        <th>SKU</th>
                        <th>Dostupné</th>
                        <th>Predaj / deň (30 dní)</th>
                        <th>Stockout (30 dní)</th>
                        <th>Runway (XLS ÷ predaj)</th>
                        <th>Predaj / deň (YTD)</th>
                        <th>Stockout (YTD)</th>
                        <th>Sync</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((r) => {
                        const meta = skladSkuMeta(r.sku);
                        const phys =
                          meta?.physicalProductKey != null
                            ? physicalByKey.get(meta.physicalProductKey)
                            : undefined;
                        const rec =
                          meta?.physicalProductKey != null
                            ? recommendedByProductKey.get(meta.physicalProductKey)
                            : undefined;
                        return (
                          <tr
                            key={`${r.inventory_item_id}-${r.location_id}`}
                            className={
                              meta && meta.status !== "active"
                                ? "sklad-row--inactive"
                                : undefined
                            }
                          >
                            <td>
                              {meta ? skladSkuStatusLabel(meta.status) : "—"}
                              {meta?.note ? (
                                <span
                                  className="sklad-row__note"
                                  title={meta.note}
                                >
                                  {" "}
                                  ⓘ
                                </span>
                              ) : null}
                            </td>
                            <td>{r.location_name || "—"}</td>
                            <td>{r.product_title?.trim() || r.sku}</td>
                            <td>{r.sku}</td>
                            <td>
                              {r.available}
                              {phys != null ? (
                                <span className="sklad-row__phys" title="Fyzický stav XLS">
                                  {" "}
                                  (XLS {phys.stock_end})
                                </span>
                              ) : null}
                            </td>
                            <td>
                              {formatAvgDaily(r.avg_daily_units_sold_30d ?? null)}
                              {r.units_sold_30d != null
                                ? ` (${r.units_sold_30d} ks)`
                                : ""}
                            </td>
                            <td>
                              {formatStockoutDate(r.estimated_stockout_date_30d)}
                            </td>
                            <td>
                              {rec != null ? (
                                <>
                                  {formatRunwayDays(rec.days_runway)}
                                  {rec.stockout_date ? (
                                    <span className="sklad-row__phys">
                                      {" "}
                                      · {formatStockoutDate(rec.stockout_date)}
                                    </span>
                                  ) : null}
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td>
                              {formatAvgDaily(
                                r.avg_daily_units_sold_ytd ?? null
                              )}
                            </td>
                            <td>{formatStockoutForRow(r)}</td>
                            <td>{formatWhen(r.fetched_at)}</td>
                          </tr>
                        );
                      })}
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
