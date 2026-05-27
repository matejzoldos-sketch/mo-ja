"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { HeaderBrand, HeaderSectionSelect } from "../components/HeaderNav";
import { INSIGHTS_DEFAULT_RANGE } from "@/lib/insights/config";
import type {
  InsightsResponse,
  Insight,
  InsightArea,
} from "@/lib/insights/types";

type RangeKey = "30d" | "90d" | "365d";
type KpiProductKey = "all" | "moja_phase_bez" | "moja_phase_plus";

const RANGE_LABELS: Record<RangeKey, string> = {
  "30d": "Posledných 30 dní",
  "90d": "Posledných 90 dní",
  "365d": "Od spustenia (Nov 2025 – Súčasnosť)",
};
const RANGE_ORDER: readonly RangeKey[] = ["30d", "90d", "365d"];

const KPI_PRODUCT_LABELS: Record<KpiProductKey, string> = {
  all: "Všetky produkty",
  moja_phase_bez: "MOJA Phase bez fytoestrogénov",
  moja_phase_plus: "MOJA Phase+ s fytoestrogénmi",
};
const KPI_PRODUCT_ORDER: readonly KpiProductKey[] = [
  "all",
  "moja_phase_bez",
  "moja_phase_plus",
];

function parseRangeParam(raw: string | null): RangeKey {
  const s = (raw || "").toLowerCase().trim();
  if (s === "ytd") return "365d";
  if (s === "30d" || s === "90d" || s === "365d") return s;
  return INSIGHTS_DEFAULT_RANGE;
}

function parseKpiProductParam(raw: string | null): KpiProductKey {
  const s = (raw || "").toLowerCase().trim();
  if (s === "moja_phase_bez" || s === "moja_phase_plus") return s;
  return "all";
}

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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const rangeFromUrl = parseRangeParam(searchParams.get("range"));
  const [range, setRange] = useState<RangeKey>(rangeFromUrl);

  const kpiProductFromUrl = parseKpiProductParam(searchParams.get("kpi_product"));
  const [kpiProduct, setKpiProduct] = useState<KpiProductKey>(kpiProductFromUrl);

  useEffect(() => setRange(rangeFromUrl), [rangeFromUrl]);
  useEffect(() => setKpiProduct(kpiProductFromUrl), [kpiProductFromUrl]);

  // If range is missing/invalid, normalize to default 90d in the URL.
  useEffect(() => {
    const raw = searchParams.get("range");
    const normalized = parseRangeParam(raw);
    if (!raw || normalized !== raw) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("range", normalized);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }, [pathname, router, searchParams]);

  const [data, setData] = useState<InsightsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [rangeMenuOpen, setRangeMenuOpen] = useState(false);
  const rangeMenuRef = useRef<HTMLDivElement>(null);
  const [kpiMenuOpen, setKpiMenuOpen] = useState(false);
  const kpiMenuRef = useRef<HTMLDivElement>(null);

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
    if (!kpiMenuOpen) return;
    const close = () => setKpiMenuOpen(false);
    const onDown = (e: MouseEvent) => {
      if (kpiMenuRef.current?.contains(e.target as Node)) return;
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
  }, [kpiMenuOpen]);

  const load = useCallback(async (r: RangeKey, kpi: KpiProductKey) => {
    setLoading(true);
    setErr(null);
    try {
      const kpiQ = kpi !== "all" ? `&kpi_product=${encodeURIComponent(kpi)}` : "";
      const q = `?range=${encodeURIComponent(r)}${kpiQ}&_=${Date.now()}`;
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
    void load(range, kpiProduct);
  }, [load, range, kpiProduct]);

  function onRangeChange(next: RangeKey) {
    setRangeMenuOpen(false);
    setRange(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function onKpiProductChange(next: KpiProductKey) {
    setKpiMenuOpen(false);
    setKpiProduct(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") params.delete("kpi_product");
    else params.set("kpi_product", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

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
      <header className="site-header">
        <div className="site-header__inner">
          <HeaderBrand />
        </div>

        <div className="site-toolbar">
          <div className="site-toolbar__filters">
            <HeaderSectionSelect />

            <div className="period-filter period-filter--range" ref={rangeMenuRef}>
              <button
                type="button"
                className="period-filter__select period-filter__select--range-trigger"
                aria-expanded={rangeMenuOpen}
                aria-haspopup="listbox"
                aria-label="Obdobie"
                onClick={() => setRangeMenuOpen((o) => !o)}
              >
                <span>{RANGE_LABELS[range]}</span>
                <span className="period-filter__chevron" aria-hidden>
                  ▼
                </span>
              </button>
              {rangeMenuOpen ? (
                <ul className="period-filter__range-list" role="listbox" aria-label="Obdobie">
                  {RANGE_ORDER.map((v) => (
                    <li key={v} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected={v === range}
                        className={
                          v === range
                            ? "period-filter__range-option is-selected"
                            : "period-filter__range-option"
                        }
                        onClick={() => onRangeChange(v)}
                      >
                        {v === range ? "✓ " : ""}
                        {RANGE_LABELS[v]}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="period-filter period-filter--kpi-product" ref={kpiMenuRef}>
              <button
                type="button"
                className="period-filter__select period-filter__select--range-trigger"
                aria-expanded={kpiMenuOpen}
                aria-haspopup="listbox"
                aria-label="Produkt"
                onClick={() => setKpiMenuOpen((o) => !o)}
              >
                <span>{KPI_PRODUCT_LABELS[kpiProduct]}</span>
                <span className="period-filter__chevron" aria-hidden>
                  ▼
                </span>
              </button>
              {kpiMenuOpen ? (
                <ul
                  className="period-filter__range-list"
                  role="listbox"
                  aria-label="Produkt"
                >
                  {KPI_PRODUCT_ORDER.map((v) => (
                    <li key={v} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected={v === kpiProduct}
                        className={
                          v === kpiProduct
                            ? "period-filter__range-option is-selected"
                            : "period-filter__range-option"
                        }
                        onClick={() => onKpiProductChange(v)}
                      >
                        {v === kpiProduct ? "✓ " : ""}
                        {KPI_PRODUCT_LABELS[v]}
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

