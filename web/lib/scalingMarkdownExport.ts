/** Markdown export for Spend (executive scaling) dashboard. */

export type ScalingExportCard = {
  title: string;
  metric_label: string;
  metric_value: number | null;
  metric_unit: string;
  target: number;
  target_op: string;
  status: string;
  detail?: Record<string, number | boolean | string | null | undefined>;
};

export type ScalingExportMonth = {
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
  meta_reported_roas?: number | null;
  meta_click_sales?: number;
  meta_view_sales?: number;
};

export type ScalingVerdictNarrative = {
  statusTitle: string;
  sections: { title?: string; body: string }[];
  actions: string[];
};

export type ScalingMarkdownInput = {
  windowFrom: string;
  windowTo: string;
  windowDays: number;
  windowLabel?: string;
  ytdFrom: string;
  asOf: string;
  verdictLabel: string;
  failReasons: string[];
  cards: ScalingExportCard[];
  monthly: ScalingExportMonth[];
  attribution?: {
    meta_click_sales: number;
    meta_view_sales: number;
    shopify_utm_net_sales: number;
    view_through_ratio_pct: number | null;
    attribution_split_is_proxy: boolean;
    warn_message: string | null;
  } | null;
  narrative?: ScalingVerdictNarrative | null;
};

function money(n: number): string {
  return new Intl.NumberFormat("sk-SK", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

function metric(v: number | null, unit: string): string {
  if (v == null) return "—";
  if (unit === "%") return `${v.toFixed(2)} %`;
  if (unit === "×") return `${v.toFixed(2)}×`;
  return String(v);
}

export function buildScalingMarkdown(input: ScalingMarkdownInput): string {
  const lines: string[] = [];
  lines.push("# MO–JA · Spend rozhodnutie");
  lines.push("");
  lines.push(
    `Okno: ${input.windowLabel ?? "aktuálny mesiac (MTD)"} (${input.windowFrom} → ${input.windowTo}, ${input.windowDays} dní)`
  );
  lines.push(`YTD od: ${input.ytdFrom}`);
  lines.push(`As of: ${input.asOf}`);
  lines.push("");
  lines.push(`## Verdikt`);
  lines.push("");
  if (input.narrative) {
    lines.push(`**${input.narrative.statusTitle}**`);
    lines.push("");
    lines.push(input.verdictLabel);
    if (input.failReasons.length) {
      lines.push("");
      for (const r of input.failReasons) lines.push(`- ${r}`);
    }
    lines.push("");
    for (const s of input.narrative.sections) {
      if (s.title) {
        lines.push(`#### ${s.title}`);
        lines.push("");
      }
      lines.push(s.body);
      lines.push("");
    }
    if (input.narrative.actions.length) {
      lines.push("#### Odporúčané akcie");
      lines.push("");
      for (const a of input.narrative.actions) lines.push(`- ${a}`);
      lines.push("");
    }
  } else {
    lines.push(`**${input.verdictLabel}**`);
    if (input.failReasons.length) {
      lines.push("");
      for (const r of input.failReasons) lines.push(`- ${r}`);
    }
  }
  lines.push("");
  lines.push("## Decision matrix (aktuálny mesiac)");
  lines.push("");
  for (const c of input.cards) {
    lines.push(
      `### ${c.title} — ${c.status.toUpperCase()}`
    );
    lines.push(
      `- ${c.metric_label}: ${metric(c.metric_value, c.metric_unit)} (target ${c.target_op} ${c.target}${c.metric_unit === "×" ? "×" : c.metric_unit === "%" ? " %" : ""})`
    );
    if (c.detail) {
      for (const [k, v] of Object.entries(c.detail)) {
        if (v == null || typeof v === "boolean") continue;
        const isMoney =
          /sales|spend|fee|value/i.test(k) && typeof v === "number";
        lines.push(`- ${k}: ${isMoney ? money(Number(v)) : String(v)}`);
      }
    }
    lines.push("");
  }

  if (input.attribution) {
    const a = input.attribution;
    lines.push("## Meta vs Shopify UTM (YTD)");
    lines.push("");
    lines.push(
      a.attribution_split_is_proxy
        ? `- Meta nadhodnotenie vs UTM: ${a.view_through_ratio_pct ?? "—"} %`
        : `- Meta View-Through Ratio: ${a.view_through_ratio_pct ?? "—"} %`
    );
    lines.push(`- Meta click sales: ${money(a.meta_click_sales)}`);
    lines.push(`- Meta view sales: ${money(a.meta_view_sales)}`);
    lines.push(`- Shopify UTM net sales: ${money(a.shopify_utm_net_sales)}`);
    if (a.warn_message) lines.push(`- ${a.warn_message}`);
    lines.push("");
  }

  lines.push("## YTD mesačne");
  lines.push("");
  lines.push(
    "| Mesiac | Net sales | Orders | Meta spend | Agency | PNO % | Store CR % | UTM ROAS | Meta ROAS |"
  );
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const m of input.monthly) {
    lines.push(
      `| ${m.month} | ${money(m.net_sales)} | ${m.orders} | ${money(m.meta_spend)} | ${money(m.agency_fee)} | ${m.blended_pno_pct ?? "—"} | ${m.store_cr_pct ?? "—"} | ${m.utm_real_roas ?? "—"} | ${m.meta_reported_roas ?? "—"} |`
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function downloadScalingMarkdown(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)} %`;
}

function fmtRoas(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(2)}×`;
}

/** Verdict narrative from live decision metrics. */
export function buildScalingVerdictNarrative(input: {
  verdict: "increase" | "hold";
  pno: number | null;
  pnoTarget: number;
  pnoOk: boolean;
  storeCr: number | null;
  storeCrTarget: number;
  storeCrOk: boolean;
  utmRoas: number | null;
  utmRoasTarget: number;
  utmRoasOk: boolean;
  metaRoas: number | null;
  viewThroughPct: number | null;
  viewThroughFocusLabel: string | null;
  viewThroughPrevPct: number | null;
  viewThroughPrevLabel: string | null;
  viewThroughRising: boolean;
}): ScalingVerdictNarrative {
  const {
    verdict,
    pno,
    pnoTarget,
    pnoOk,
    storeCr,
    storeCrOk,
    utmRoas,
    utmRoasTarget,
    utmRoasOk,
    metaRoas,
    viewThroughPct,
    viewThroughFocusLabel,
    viewThroughPrevPct,
    viewThroughPrevLabel,
    viewThroughRising,
  } = input;

  if (verdict === "increase") {
    return {
      statusTitle: "Biznis, trh aj Meta sú v zelenom — škálovanie dáva zmysel",
      sections: [
        {
          body: `Blended PNO ${fmtPct(pno)} (target ≤ ${pnoTarget.toFixed(0)} %) , Store CR ${fmtPct(storeCr)} a UTM Real ROAS ${fmtRoas(utmRoas)} sú nad cieľmi. Podmienky na opatrné zvýšenie Meta spendu (+15 %) sú splnené.`,
        },
      ],
      actions: [
        "Zvýšiť Meta rozpočet kontrolovane (+15 %) a sledovať UTM ROAS denne.",
        "Držať exclusions pre existujúcich zákazníkov, aby sa neriedila akvizícia.",
      ],
    };
  }

  if (pnoOk && storeCrOk && !utmRoasOk) {
    const vtBit =
      viewThroughPct != null && viewThroughFocusLabel
        ? viewThroughRising &&
          viewThroughPrevPct != null &&
          viewThroughPrevLabel
          ? ` View-Through Ratio v ${viewThroughFocusLabel}: ${viewThroughPct.toFixed(1)} % (vs ${viewThroughPrevPct.toFixed(1)} % v ${viewThroughPrevLabel}), čím Meta umelo nafukuje svoje výsledky.`
          : ` Podiel View-Through v ${viewThroughFocusLabel}: ${viewThroughPct.toFixed(1)} %.`
        : "";

    return {
      statusTitle: "Biznis je zdravý, akvizícia z Mety zlyháva",
      sections: [
        {
          body: `Celková ekonomika e-shopu funguje výborne — Blended PNO držíme na úrovni ${fmtPct(pno)} (target ≤ ${pnoTarget.toFixed(0)} %) a konverzný pomer webu dosahuje ${fmtPct(storeCr)}. Produkt aj web teda konvertujú stabilne. Problémom je výhradne efektivita Meta reklamy.`,
        },
        {
          title: "Meta parazituje na organickom dopyte",
          body: `Zatiaľ čo Meta v Ads Manageri vykazuje ROAS ${fmtRoas(metaRoas)}, reálny prínos cez UTM prekliky je len ${fmtRoas(utmRoas)} (pod cieľom ${fmtRoas(utmRoasTarget)}). Kampane oslovujú najmä teplé publikum, ktoré by nakúpilo aj bez reklamy.${vtBit}`,
        },
      ],
      actions: [
        `Nezvyšovať rozpočet na Meta Ads až do momentu, kým UTM ROAS neprekročí ${fmtRoas(utmRoasTarget)}.`,
        "Vyžadovať od agentúry návrat k akvizícii: nastaviť prísne vylúčenia (exclusions) pre návštevníkov webu a existujúcich zákazníkov.",
        "Investovať do retencie a AOV: presmerovať kapacity do e-mailingu (Klaviyo), cross-sellu v košíku a budovania vlastnej databázy pred Q4.",
      ],
    };
  }

  const failing: string[] = [];
  if (!pnoOk) failing.push(`Blended PNO ${fmtPct(pno)} (target ≤ ${pnoTarget} %)`);
  if (!storeCrOk)
    failing.push(
      `Store CR ${fmtPct(storeCr)} (target ≥ ${input.storeCrTarget} %)`
    );
  if (!utmRoasOk)
    failing.push(
      `UTM Real ROAS ${fmtRoas(utmRoas)} (target ≥ ${fmtRoas(utmRoasTarget)})`
    );

  return {
    statusTitle: "Verdikt: nezvyšovať spend — niektoré metriky zlyhávajú",
    sections: [
      {
        body: `Rozhodovacia matica nie je celá zelená. Zlyháva: ${failing.join("; ") || "neznáme metriky"}.`,
      },
    ],
    actions: [
      "Nezvyšovať Meta rozpočet, kým nie sú všetky tri karty v OK.",
      "Overiť dáta (sessions, UTM, Meta spend) a upraviť kampane podľa zlyhávajúcej metriky.",
    ],
  };
}
