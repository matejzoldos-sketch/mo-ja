"use client";

import { useCallback, useEffect, useState } from "react";
import { HeaderNav } from "../components/HeaderNav";

type InvRow = {
  inventory_item_id: number;
  location_id: number;
  location_name: string | null;
  sku: string;
  available: number;
  updated_at: string | null;
  fetched_at: string | null;
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

export default function SkladClient() {
  const [rows, setRows] = useState<InvRow[] | null>(null);
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
        return;
      }
      setRows(json as InvRow[]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Fetch failed");
      setRows(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totalAvailable =
    rows?.reduce((s, r) => s + Number(r.available), 0) ?? 0;

  return (
    <>
      <header className="site-header">
        <div className="site-header__inner">
          <HeaderNav />
        </div>
      </header>

      <main className="main-wrap">
        {loading && <p className="msg">Načítavam…</p>}
        {err && !loading && (
          <p className="msg msg-error">
            {err}{" "}
            Skontroluj env a migráciu <code>005_inventory_dashboard_rpc.sql</code>.
          </p>
        )}
        {!loading && !err && rows && (
          <>
            <section className="kpi-grid sklad-kpi">
              <div className="kpi-card">
                <div className="kpi-card__label">Položiek v zozname</div>
                <div className="kpi-card__value">{rows.length}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-card__label">Dostupné kusy (súčet)</div>
                <div className="kpi-card__value">{totalAvailable}</div>
              </div>
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
