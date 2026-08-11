/** Micro-glossary for Spend decision dashboard (non-technical readers). */

export type GlossaryTerm = {
  id: string;
  term: string;
  definition: string;
};

export const SCALING_GLOSSARY: GlossaryTerm[] = [
  {
    id: "blended_pno",
    term: "Blended PNO",
    definition:
      "Koľko % z celkových tržieb zje marketing (reklama + poplatok agentúry). Stráži celkovú ziskovosť e-shopu (cieľ ≤ 12 %).",
  },
  {
    id: "utm_real_roas",
    term: "UTM Real ROAS",
    definition:
      "Reálna tržba z preklikov na každé 1 € vrazene do reklamy (merané cez Shopify UTM). Cieľ pre skalovanie je ≥ 2.50×.",
  },
  {
    id: "meta_reported_roas",
    term: "Meta Reported ROAS",
    definition:
      "Nahlásené číslo z Ads Managera. Býva nadhodnotené, lebo si započítava aj ľudí, ktorí na reklamu neklikli.",
  },
  {
    id: "store_cr",
    term: "Store CR (Konverzný pomer)",
    definition:
      "Koľko zo 100 návštevníkov e-shopu nakúpi. Ukazuje zdravie produktu a webu.",
  },
  {
    id: "view_through",
    term: "View-Through Ratio",
    definition:
      "% tržieb, pri ktorých si Meta pripisuje zásluhu len preto, že človek reklamu uvidel, no neklikol na ňu (riziko parazitovania).",
  },
  {
    id: "tof_rmkt",
    term: "TOF / RMKT",
    definition:
      "TOF = akvizícia úplne nových ľudí (nová krv). RMKT = retargeting (pripomínanie sa existujúcim).",
  },
  {
    id: "meta_cpa",
    term: "Meta CPA",
    definition:
      "Koľko € stojí jedna Meta nákupná konverzia (Meta spend ÷ Meta purchases). OK, ak je ≤ prírastková marža na objednávku (AOV × marža %).",
  },
  {
    id: "utm_cac",
    term: "UTM CAC",
    definition:
      "Prísnejší náklad na zákazníka: Meta spend ÷ počet Shopify objednávok s Meta UTM (bez View-Through nadhodnotenia).",
  },
];

/** Short tips keyed by decision card id / metric. */
export const SCALING_METRIC_TIPS: Record<string, string> = {
  biznis: SCALING_GLOSSARY[0].definition,
  trh: SCALING_GLOSSARY[3].definition,
  meta: SCALING_GLOSSARY[1].definition,
  cac: SCALING_GLOSSARY[5].definition,
  meta_reported_roas: SCALING_GLOSSARY[2].definition,
  view_through: SCALING_GLOSSARY[4].definition,
  utm_cac: SCALING_GLOSSARY[6].definition,
};
