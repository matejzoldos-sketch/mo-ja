"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Chart as ChartJS, registerables } from "chart.js";
import type { ChartData, ChartOptions } from "chart.js";
import { Chart } from "react-chartjs-2";
import { formatMonthLabelSk } from "@/lib/dashboardPeriodFilter";

ChartJS.register(...registerables);

type CardStatus = "ok" | "warn" | "unknown";

type DecisionCard = {
  id: string;
  title: string;
  metric_label: string;
  metric_value: number | null;
  metric_unit: string;
  target: number;
  target_op: string;
  status: CardStatus;
  detail: Record<string, number | boolean | string | null | undefined>;
};

type MonthRow = {
  month: string;
  net_sales: number;
  orders: number;
  aov: number | null;
  meta_spend: number;
  agency_fee: number;
  total_spend: number;
  blended_pno_pct: number | null;
  sessions: number;
  store_cr_pct: number | null;
  utm_meta_net_sales: number;
  utm_real_roas: number | null;
  meta_purchases: number;
  meta_reported_sales_est: number | null;
  meta_reported_roas_est: number | null;
  meta_reported_sales?: number | null;
  meta_reported_roas?: number | null;
  meta_roas_is_actual?: boolean;
  meta_inflation_ratio: number | null;
};

type ScalingPayload = {
  meta: {
    window_from: string;
    window_to: string;
    window_days: number;
    ytd_from: string;
    as_of: string;
    targets: {
      blended_pno_pct_max: number;
      store_cr_pct_min: number;
      utm_real_roas_min: number;
    };
    notes: string[];
  };
  decision: {
    verdict: "increase" | "hold";
    verdict_label: string;
    fail_reasons: string[];
    cards: {
      biznis: DecisionCard;
      trh: DecisionCard;
      meta: DecisionCard;
    };
  };
  monthly: MonthRow[];
};

const SPEND = "#c45c26";
const PNO = "#dc2626";
const CR = "#2563eb";
const AOV = "#7c3aed";
const META_REP = "#94a3b8";
const UTM = "#0f766e";

function formatMoney(n: number): string {
  return new Intl.NumberFormat("sk-SK", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatMetric(card: DecisionCard): string {
  if (card.metric_value == null) return "—";
  if (card.metric_unit === "%") return `${card.metric_value.toFixed(2)} %`;
  if (card.metric_unit === "×") return `${card.metric_value.toFixed(2)}×`;
  return String(card.metric_value);
}

function statusLabel(s: CardStatus): string {
  if (s === "ok") return "OK";
  if (s === "warn") return "WARNING";
  return "CHÝBAJÚ DÁTA";
}

export default function ExecutiveScalingDashboard() {
  const [data, setData] = useState<ScalingPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/scaling?_=${Date.now()}`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setData((await res.json()) as ScalingPayload);
    } catch (e) {
      setData(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cards = useMemo(() => {
    if (!data) return [];
    return [data.decision.cards.biznis, data.decision.cards.trh, data.decision.cards.meta];
  }, [data]);

  const profitChart = useMemo(() => {
    if (!data?.monthly?.length) return null;
    const labels = data.monthly.map((m) => formatMonthLabelSk(m.month));
    const chart: ChartData<"bar" | "line"> = {
      labels,
      datasets: [
        {
          type: "bar" as const,
          label: "Net sales",
          data: data.monthly.map((m) => m.net_sales),
          backgroundColor: "rgba(74, 93, 66, 0.55)",
          borderRadius: 4,
          yAxisID: "y",
          order: 2,
        },
        {
          type: "bar" as const,
          label: "Total spend (Meta + agency)",
          data: data.monthly.map((m) => m.total_spend),
          backgroundColor: "rgba(196, 92, 38, 0.55)",
          borderRadius: 4,
          yAxisID: "y",
          order: 2,
        },
        {
          type: "line" as const,
          label: "Blended PNO %",
          data: data.monthly.map((m) => m.blended_pno_pct),
          borderColor: PNO,
          backgroundColor: PNO,
          borderWidth: 2,
          pointRadius: 3,
          yAxisID: "y1",
          order: 1,
        },
      ],
    };
    return chart;
  }, [data]);

  const profitOptions = useMemo<ChartOptions<"bar">>(() => {
    const target = data?.meta.targets.blended_pno_pct_max ?? 12;
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom" },
        annotation: undefined,
      },
      scales: {
        y: {
          type: "linear",
          position: "left",
          title: { display: true, text: "EUR" },
          grid: { color: "rgba(15,23,42,0.06)" },
        },
        y1: {
          type: "linear",
          position: "right",
          title: { display: true, text: "PNO %" },
          grid: { drawOnChartArea: false },
          suggestedMin: 0,
          suggestedMax: Math.max(20, target * 1.5),
        },
      },
    };
  }, [data]);

  const demandChart = useMemo(() => {
    if (!data?.monthly?.length) return null;
    return {
      labels: data.monthly.map((m) => formatMonthLabelSk(m.month)),
      datasets: [
        {
          label: "Store CR %",
          data: data.monthly.map((m) => m.store_cr_pct),
          borderColor: CR,
          backgroundColor: CR,
          borderWidth: 2,
          pointRadius: 3,
          yAxisID: "y",
          spanGaps: true,
        },
        {
          label: "AOV €",
          data: data.monthly.map((m) => m.aov),
          borderColor: AOV,
          backgroundColor: AOV,
          borderWidth: 2,
          pointRadius: 3,
          yAxisID: "y1",
          spanGaps: true,
        },
      ],
    } satisfies ChartData<"line">;
  }, [data]);

  const demandOptions = useMemo<ChartOptions<"line">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { position: "bottom" } },
      scales: {
        y: {
          position: "left",
          title: { display: true, text: "CR %" },
          grid: { color: "rgba(15,23,42,0.06)" },
        },
        y1: {
          position: "right",
          title: { display: true, text: "AOV €" },
          grid: { drawOnChartArea: false },
        },
      },
    }),
    []
  );

  const auditChart = useMemo(() => {
    if (!data?.monthly?.length) return null;
    return {
      labels: data.monthly.map((m) => formatMonthLabelSk(m.month)),
      datasets: [
        {
          label: "Meta ROAS",
          data: data.monthly.map((m) => m.meta_reported_roas ?? m.meta_reported_roas_est),
          borderColor: META_REP,
          backgroundColor: META_REP,
          borderWidth: 2,
          borderDash: [6, 4],
          pointRadius: 3,
          yAxisID: "y",
          spanGaps: true,
        },
        {
          label: "UTM Real ROAS",
          data: data.monthly.map((m) => m.utm_real_roas),
          borderColor: UTM,
          backgroundColor: UTM,
          borderWidth: 2,
          pointRadius: 3,
          yAxisID: "y",
          spanGaps: true,
        },
        {
          label: "Meta inflation ratio",
          data: data.monthly.map((m) => m.meta_inflation_ratio),
          borderColor: SPEND,
          backgroundColor: SPEND,
          borderWidth: 2,
          pointRadius: 3,
          yAxisID: "y1",
          spanGaps: true,
        },
      ],
    } satisfies ChartData<"line">;
  }, [data]);

  const auditOptions = useMemo<ChartOptions<"line">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { position: "bottom" } },
      scales: {
        y: {
          position: "left",
          title: { display: true, text: "ROAS ×" },
          grid: { color: "rgba(15,23,42,0.06)" },
        },
        y1: {
          position: "right",
          title: { display: true, text: "Inflation" },
          grid: { drawOnChartArea: false },
        },
      },
    }),
    []
  );

  if (loading) return <p className="msg">Načítavam spend rozhodnutie…</p>;
  if (err) {
    return (
      <p className="msg msg-error">
        Chyba: {err}{" "}
        <button type="button" onClick={() => void load()}>
          Skúsiť znova
        </button>
      </p>
    );
  }
  if (!data) return <p className="msg">Žiadne dáta.</p>;

  const { decision, meta } = data;
  const increase = decision.verdict === "increase";

  return (
    <div className="scaling-dash">
      <div className="scaling-dash__intro">
        <h1 className="dashboard-card__title">Spend rozhodnutie</h1>
        <p className="scaling-dash__sub">
          Posledných {meta.window_days} dní ({meta.window_from} → {meta.window_to}) · ciele: PNO ≤{" "}
          {meta.targets.blended_pno_pct_max} % · CR ≥ {meta.targets.store_cr_pct_min} % · UTM ROAS ≥{" "}
          {meta.targets.utm_real_roas_min}×
        </p>
      </div>

      <div className="scaling-matrix">
        {cards.map((card) => (
          <article
            key={card.id}
            className={`scaling-card scaling-card--${card.status}`}
          >
            <div className="scaling-card__top">
              <h2 className="scaling-card__title">{card.title}</h2>
              <span className={`scaling-pill scaling-pill--${card.status}`}>
                {statusLabel(card.status)}
              </span>
            </div>
            <div className="scaling-card__metric">{formatMetric(card)}</div>
            <div className="scaling-card__label">
              {card.metric_label} · target {card.target_op} {card.target}
              {card.metric_unit === "×" ? "×" : card.metric_unit === "%" ? " %" : ""}
            </div>
            {card.id === "biznis" ? (
              <ul className="scaling-card__detail">
                <li>Net sales {formatMoney(Number(card.detail.net_sales ?? 0))}</li>
                <li>Meta spend {formatMoney(Number(card.detail.meta_spend ?? 0))}</li>
                <li>
                  Agency {formatMoney(Number(card.detail.agency_fee ?? 0))}
                  {card.detail.agency_fee_monthly != null
                    ? ` (fix ${formatMoney(Number(card.detail.agency_fee_monthly))}/mes${
                        card.detail.agency_fee_is_override ? ", dočasne" : ""
                      })`
                    : ""}
                </li>
              </ul>
            ) : null}
            {card.id === "trh" ? (
              <ul className="scaling-card__detail">
                <li>Objednávky {card.detail.orders ?? 0}</li>
                <li>Sessions {card.detail.sessions ?? 0}</li>
              </ul>
            ) : null}
            {card.id === "meta" ? (
              <ul className="scaling-card__detail">
                <li>UTM Meta sales {formatMoney(Number(card.detail.utm_meta_net_sales ?? 0))}</li>
                <li>Meta spend {formatMoney(Number(card.detail.meta_spend ?? 0))}</li>
                <li>
                  Meta ROAS{" "}
                  {card.detail.meta_reported_roas != null ||
                  card.detail.meta_reported_roas_est != null
                    ? `${Number(
                        card.detail.meta_reported_roas ??
                          card.detail.meta_reported_roas_est
                      ).toFixed(2)}×`
                    : "—"}
                  {card.detail.meta_roas_is_actual === false ? " (odhad)" : ""}
                </li>
              </ul>
            ) : null}
          </article>
        ))}
      </div>

      <div
        className={`scaling-verdict ${increase ? "scaling-verdict--ok" : "scaling-verdict--hold"}`}
        role="status"
      >
        <strong>{decision.verdict_label}</strong>
        {!increase && decision.fail_reasons?.length ? (
          <ul>
            {decision.fail_reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <section className="scaling-trends">
        <h2 className="dashboard-card__title">YTD trendy</h2>
        <p className="scaling-dash__sub">Od {meta.ytd_from} · net (bez DPH)</p>

        <div className="chart-card scaling-chart">
          <h3>Reálna ziskovosť</h3>
          <p className="scaling-chart__hint">
            Net sales vs spend · Blended PNO (target {meta.targets.blended_pno_pct_max} %)
          </p>
          <div className="scaling-chart__canvas">
            {profitChart ? (
              <Chart type="bar" data={profitChart as ChartData<"bar">} options={profitOptions} />
            ) : null}
          </div>
        </div>

        <div className="chart-card scaling-chart">
          <h3>Dopyt a nákupné správanie</h3>
          <p className="scaling-chart__hint">Store CR % a AOV — CR vyžaduje sessions sync</p>
          <div className="scaling-chart__canvas">
            {demandChart ? <Chart type="line" data={demandChart} options={demandOptions} /> : null}
          </div>
        </div>

        <div className="chart-card scaling-chart">
          <h3>Audit pravdivosti Meta Ads</h3>
          <p className="scaling-chart__hint">
            Meta ROAS (purchase value) vs UTM Real ROAS · inflation ratio
          </p>
          <div className="scaling-chart__canvas">
            {auditChart ? <Chart type="line" data={auditChart} options={auditOptions} /> : null}
          </div>
        </div>
      </section>

      <details className="scaling-notes">
        <summary>Metodika a limity dát</summary>
        <ul>
          {meta.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
