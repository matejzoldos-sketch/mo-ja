"use client";

import { useCallback, useEffect, useState } from "react";
import { HeaderBrand, HeaderSectionSelect } from "../components/HeaderNav";
import { INSIGHTS_DEFAULT_RANGE } from "@/lib/insights/config";
import type {
  InsightsResponse,
  Insight,
  InsightArea,
} from "@/lib/insights/types";

function resolveInsightArea(i: Insight): InsightArea {
  if (i.area === "marketing" || i.area === "inventory" || i.area === "sales") {
    return i.area;
  }
  const href = i.link?.href ?? "";
  if (href.includes("/marketing") || i.id.startsWith("utm_")) return "marketing";
  if (
    href.startsWith("/sklad") ||
    i.id.startsWith("stock") ||
    i.id === "stockout_soon" ||
    i.id === "overstock_days" ||
    i.id === "slow_mover_stock"
  ) {
    return "inventory";
  }
  return "sales";
}

function severityLabel(s: Insight["severity"]): string {
  if (s === "critical") return "Kritické";
  if (s === "warning") return "Pozor";
  return "Info";
}

export default function InsightyClient() {
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const q = `?range=${encodeURIComponent(INSIGHTS_DEFAULT_RANGE)}&_=${Date.now()}`;
      const res = await fetch(`/api/insights${q}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      const json = (await res.json()) as InsightsResponse & { error?: string };
      if (!res.ok) {
        setErr(json.error || `HTTP ${res.status}`);
        setData(null);
        return;
      }
      setData(json);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Fetch failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const risks = data?.risks ?? [];
  const opportunities = data?.opportunities ?? [];

  const renderCard = (i: Insight) => {
    const area = resolveInsightArea(i);
    return (
      <article
        key={i.id}
        className={`insight-card insight-card--${i.kind} insight-card--${i.severity}${
          area === "marketing"
            ? " insight-card--marketing"
            : area === "inventory"
              ? " insight-card--inventory"
              : ""
        }`}
      >
        <div className="insight-card__head">
          <div className="insight-card__kicker">
            {area === "inventory" ? (
              <span className="insight-card__badge insight-card__badge--inventory">
                Sklad
              </span>
            ) : area === "marketing" ? (
              <span className="insight-card__badge insight-card__badge--marketing">
                Marketing
              </span>
            ) : (
              <span className="insight-card__badge insight-card__badge--sales">
                Predaj
              </span>
            )}
            {i.kind === "risk" ? "⚠ Riziko" : "✦ Príležitosť"} ·{" "}
            {severityLabel(i.severity)}
          </div>
          <h3 className="insight-card__title">{i.title}</h3>
        </div>
        <p className="insight-card__body">{i.body}</p>
        {i.metric ? (
          <div className="insight-card__metric">
            <span className="insight-card__metric-label">{i.metric.label}</span>
            <span className="insight-card__metric-value">{i.metric.value}</span>
            {i.metric.delta ? (
              <span className="insight-card__metric-delta">{i.metric.delta}</span>
            ) : null}
          </div>
        ) : null}
        {i.link ? (
          <a className="insight-card__link" href={i.link.href}>
            {i.link.label} →
          </a>
        ) : null}
      </article>
    );
  };

  return (
    <>
      <header className="site-header site-header--sklad">
        <div className="site-header__inner">
          <HeaderBrand />
          <div className="site-toolbar__filters site-toolbar__filters--under-brand">
            <HeaderSectionSelect />
          </div>
        </div>
      </header>

      <main className="main-wrap">
        {loading ? <p className="msg">Načítavam…</p> : null}
        {err && !loading ? <p className="msg msg-error">{err}</p> : null}

        {!loading && !err ? (
          <section className="insights-grid" aria-label="Insighty">
            <div className="insights-col">
              <h2 className="insights-col__title">Riziká</h2>
              {risks.length ? risks.map(renderCard) : <p className="msg">—</p>}
            </div>
            <div className="insights-col">
              <h2 className="insights-col__title">Príležitosti</h2>
              {opportunities.length ? (
                opportunities.map(renderCard)
              ) : (
                <p className="msg">—</p>
              )}
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}
