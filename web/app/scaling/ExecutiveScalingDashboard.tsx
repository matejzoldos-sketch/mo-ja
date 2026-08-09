"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chart as ChartJS, registerables } from "chart.js";
import type { ChartData, ChartOptions } from "chart.js";
import { Chart } from "react-chartjs-2";
import { formatMonthLabelSk } from "@/lib/dashboardPeriodFilter";
import {
  buildScalingMarkdown,
  buildScalingVerdictNarrative,
  downloadScalingMarkdown,
} from "@/lib/scalingMarkdownExport";

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
  meta_click_sales?: number;
  meta_view_sales?: number;
  attribution_split_is_proxy?: boolean;
  meta_inflation_ratio: number | null;
};

type AttributionSummary = {
  meta_click_sales: number;
  meta_view_sales: number;
  meta_reported_sales_split: number;
  shopify_utm_net_sales: number;
  view_through_ratio_pct: number | null;
  view_through_ratio_prev_pct?: number | null;
  focus_month?: string | null;
  prev_month?: string | null;
  focus_month_label?: string | null;
  prev_month_label?: string | null;
  view_through_rising?: boolean;
  view_through_warn: boolean;
  attribution_split_is_proxy: boolean;
  headline?: string | null;
  warn_message: string | null;
};

type ScalingPayload = {
  meta: {
    window_from: string;
    window_to: string;
    window_days: number;
    window_label?: string;
    ytd_from: string;
    as_of: string;
    targets: {
      blended_pno_pct_max: number;
      store_cr_pct_min: number;
      utm_real_roas_min: number;
    };
    attribution?: AttributionSummary;
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
const META_CLICK = "#0f4c5c";
const META_VIEW = "#f97316";
const UTM = "#16a34a";

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
  const [pdfExporting, setPdfExporting] = useState(false);
  const pdfExportRef = useRef<HTMLDivElement>(null);

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

  const auditIsProxy =
    data?.meta.attribution?.attribution_split_is_proxy !== false;

  const auditChart = useMemo(() => {
    if (!data?.monthly?.length) return null;
    return {
      labels: data.monthly.map((m) => formatMonthLabelSk(m.month)),
      datasets: [
        {
          type: "bar" as const,
          label: auditIsProxy ? "Zhoda s Shopify UTM" : "Meta click sales (7d)",
          data: data.monthly.map((m) => m.meta_click_sales ?? 0),
          backgroundColor: META_CLICK,
          borderColor: META_CLICK,
          stack: "meta",
          yAxisID: "y",
          order: 2,
        },
        {
          type: "bar" as const,
          label: auditIsProxy ? "Meta navyše vs UTM" : "Meta view-through (1d)",
          data: data.monthly.map((m) => m.meta_view_sales ?? 0),
          backgroundColor: "rgba(249, 115, 22, 0.72)",
          borderColor: META_VIEW,
          borderWidth: 1,
          borderDash: [4, 2],
          stack: "meta",
          yAxisID: "y",
          order: 2,
        },
        {
          type: "line" as const,
          label: "Shopify UTM net sales",
          data: data.monthly.map((m) => m.utm_meta_net_sales),
          borderColor: UTM,
          backgroundColor: UTM,
          borderWidth: 3,
          pointRadius: 4,
          pointBackgroundColor: "#fff",
          pointBorderColor: UTM,
          pointBorderWidth: 2,
          yAxisID: "y",
          tension: 0.25,
          order: 1,
          spanGaps: true,
        },
      ],
    };
  }, [data, auditIsProxy]);

  const auditOptions = useMemo<ChartOptions>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = Number(ctx.parsed.y ?? 0);
              return `${ctx.dataset.label}: ${formatMoney(v)}`;
            },
          },
        },
      },
      scales: {
        x: { stacked: true },
        y: {
          stacked: true,
          position: "left",
          title: { display: true, text: "Tržby €" },
          grid: { color: "rgba(15,23,42,0.06)" },
        },
      },
    }),
    []
  );

  const downloadMd = useCallback(() => {
    if (!data) return;
    const biz = data.decision.cards.biznis;
    const tr = data.decision.cards.trh;
    const mc = data.decision.cards.meta;
    const narrative = buildScalingVerdictNarrative({
      verdict: data.decision.verdict,
      pno: biz.metric_value,
      pnoTarget: biz.target,
      pnoOk: biz.status === "ok",
      storeCr: tr.metric_value,
      storeCrTarget: tr.target,
      storeCrOk: tr.status === "ok",
      utmRoas: mc.metric_value,
      utmRoasTarget: mc.target,
      utmRoasOk: mc.status === "ok",
      metaRoas:
        mc.detail.meta_reported_roas != null
          ? Number(mc.detail.meta_reported_roas)
          : mc.detail.meta_reported_roas_est != null
            ? Number(mc.detail.meta_reported_roas_est)
            : null,
      viewThroughPct: data.meta.attribution?.view_through_ratio_pct ?? null,
      viewThroughFocusLabel: data.meta.attribution?.focus_month_label ?? null,
      viewThroughPrevPct: data.meta.attribution?.view_through_ratio_prev_pct ?? null,
      viewThroughPrevLabel: data.meta.attribution?.prev_month_label ?? null,
      viewThroughRising: Boolean(data.meta.attribution?.view_through_rising),
    });
    const md = buildScalingMarkdown({
      windowFrom: data.meta.window_from,
      windowTo: data.meta.window_to,
      windowDays: data.meta.window_days,
      windowLabel: data.meta.window_label,
      ytdFrom: data.meta.ytd_from,
      asOf: data.meta.as_of,
      verdictLabel: data.decision.verdict_label,
      failReasons: data.decision.fail_reasons ?? [],
      cards: [biz, tr, mc],
      monthly: data.monthly,
      attribution: data.meta.attribution ?? null,
      narrative,
    });
    const from = data.meta.window_from.replace(/\s/g, "");
    const to = data.meta.window_to.replace(/\s/g, "");
    downloadScalingMarkdown(md, `spend-scaling_${from}_${to}.md`);
  }, [data]);

  const downloadPdf = useCallback(async () => {
    const root = pdfExportRef.current;
    if (!root || !data) return;
    setPdfExporting(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      const canvas = await html2canvas(root, {
        scale: 1.75,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
        scrollX: 0,
        scrollY: -window.scrollY,
        windowWidth: root.scrollWidth,
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW;
      const imgH = (canvas.height * imgW) / canvas.width;
      let heightLeft = imgH;
      let y = 0;

      pdf.addImage(imgData, "PNG", 0, y, imgW, imgH);
      heightLeft -= pageH;
      while (heightLeft > 0) {
        y = heightLeft - imgH;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, y, imgW, imgH);
        heightLeft -= pageH;
      }

      const from = data.meta.window_from.replace(/\s/g, "");
      const to = data.meta.window_to.replace(/\s/g, "");
      pdf.save(`spend-scaling_${from}_${to}.pdf`);
    } catch (e) {
      console.error(e);
      window.alert(
        e instanceof Error
          ? e.message
          : "Export do PDF zlyhal. Skús znova alebo iný prehliadač."
      );
    } finally {
      setPdfExporting(false);
    }
  }, [data]);

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
  const biznis = decision.cards.biznis;
  const trh = decision.cards.trh;
  const metaCard = decision.cards.meta;
  const narrative = buildScalingVerdictNarrative({
    verdict: decision.verdict,
    pno: biznis.metric_value,
    pnoTarget: biznis.target,
    pnoOk: biznis.status === "ok",
    storeCr: trh.metric_value,
    storeCrTarget: trh.target,
    storeCrOk: trh.status === "ok",
    utmRoas: metaCard.metric_value,
    utmRoasTarget: metaCard.target,
    utmRoasOk: metaCard.status === "ok",
    metaRoas:
      metaCard.detail.meta_reported_roas != null
        ? Number(metaCard.detail.meta_reported_roas)
        : metaCard.detail.meta_reported_roas_est != null
          ? Number(metaCard.detail.meta_reported_roas_est)
          : null,
    viewThroughPct: meta.attribution?.view_through_ratio_pct ?? null,
    viewThroughFocusLabel: meta.attribution?.focus_month_label ?? null,
    viewThroughPrevPct: meta.attribution?.view_through_ratio_prev_pct ?? null,
    viewThroughPrevLabel: meta.attribution?.prev_month_label ?? null,
    viewThroughRising: Boolean(meta.attribution?.view_through_rising),
  });

  return (
    <div className="scaling-dash">
      <div className="scaling-dash__toolbar">
        <div className="scaling-dash__intro">
          <h1 className="dashboard-card__title">Spend rozhodnutie</h1>
          <p className="scaling-dash__sub">
            {meta.window_label ?? "Aktuálny mesiac"} ({meta.window_from} → {meta.window_to},{" "}
            {meta.window_days} dní) · ciele: PNO ≤ {meta.targets.blended_pno_pct_max} % · CR ≥{" "}
            {meta.targets.store_cr_pct_min} % · UTM ROAS ≥ {meta.targets.utm_real_roas_min}×
          </p>
        </div>
        <div className="site-toolbar__actions">
          <button
            type="button"
            className="dashboard-export-btn"
            onClick={downloadMd}
          >
            Stiahnuť MD
          </button>
          <button
            type="button"
            className="dashboard-export-btn dashboard-export-btn--accent"
            disabled={pdfExporting}
            aria-busy={pdfExporting}
            onClick={() => void downloadPdf()}
          >
            {pdfExporting ? "Generujem PDF…" : "Stiahnuť PDF"}
          </button>
        </div>
      </div>

      <div className="dashboard-pdf-root" ref={pdfExportRef}>
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
              {card.metric_label} · {meta.window_label ?? "aktuálny mesiac"} · target{" "}
              {card.target_op} {card.target}
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
        <strong className="scaling-verdict__status">{narrative.statusTitle}</strong>
        <p className="scaling-verdict__action">{decision.verdict_label}</p>
        <div className="scaling-verdict__narrative">
          {narrative.sections.map((s) => (
            <div key={s.title ?? s.body.slice(0, 40)} className="scaling-verdict__block">
              {s.title ? <h4>{s.title}</h4> : null}
              <p>{s.body}</p>
            </div>
          ))}
          {narrative.actions.length ? (
            <div className="scaling-verdict__block">
              <h4>Odporúčané akcie</h4>
              <ul>
                {narrative.actions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      <section className="scaling-trends">
        <h2 className="dashboard-card__title">YTD trendy</h2>
        <p className="scaling-dash__sub">Od {meta.ytd_from} · net (bez DPH)</p>

        <div className="chart-card scaling-chart">
          <h3>Reálna ziskovosť</h3>
          <p className="scaling-chart__hint">
            Mesačné net sales vs spend · Blended PNO po kalendárnych mesiacoch
            (scorecard vyššie = {meta.window_label ?? "aktuálny mesiac (MTD)"})
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
            {meta.attribution?.attribution_split_is_proxy !== false
              ? "Meta reportované tržby vs Shopify UTM — oranžová = Meta navyše oproti UTM"
              : "Attribution cannibalization — Meta click vs view-through vs Shopify UTM"}
          </p>
          {meta.attribution ? (
            <div
              className={`scaling-attr-badge${
                meta.attribution.view_through_warn ? " scaling-attr-badge--warn" : ""
              }`}
            >
              <div className="scaling-attr-badge__metric">
                {meta.attribution.attribution_split_is_proxy ? (
                  <>
                    Meta nadhodnotenie vs UTM{" "}
                    <strong>
                      {meta.attribution.view_through_ratio_pct != null
                        ? `${meta.attribution.view_through_ratio_pct.toFixed(1)} %`
                        : "—"}
                    </strong>
                  </>
                ) : meta.attribution.headline ? (
                  <strong>{meta.attribution.headline}</strong>
                ) : (
                  <>
                    Meta View-Through Ratio{" "}
                    <strong>
                      {meta.attribution.view_through_ratio_pct != null
                        ? `${meta.attribution.view_through_ratio_pct.toFixed(1)} %`
                        : "—"}
                    </strong>
                  </>
                )}
              </div>
              <div className="scaling-attr-badge__detail">
                {meta.attribution.attribution_split_is_proxy ? (
                  <>
                    UTM {formatMoney(meta.attribution.shopify_utm_net_sales)} · Meta navyše{" "}
                    {formatMoney(meta.attribution.meta_view_sales)} · Meta spolu{" "}
                    {formatMoney(meta.attribution.meta_reported_sales_split)}
                  </>
                ) : (
                  <>
                    Click {formatMoney(meta.attribution.meta_click_sales)} · View{" "}
                    {formatMoney(meta.attribution.meta_view_sales)} · UTM{" "}
                    {formatMoney(meta.attribution.shopify_utm_net_sales)}
                  </>
                )}
              </div>
              {meta.attribution.view_through_warn &&
              meta.attribution.warn_message &&
              !meta.attribution.view_through_rising ? (
                <p className="scaling-attr-badge__warn">{meta.attribution.warn_message}</p>
              ) : null}
            </div>
          ) : null}
          <div className="scaling-chart__canvas">
            {auditChart ? (
              <Chart type="bar" data={auditChart as ChartData<"bar">} options={auditOptions} />
            ) : null}
          </div>
        </div>
      </section>
      </div>
    </div>
  );
}
