/** Shopify SKU status — podľa overenia u firmy (1. 9. 2026). */

export type SkladSkuStatus = "active" | "inactive" | "deprecated";

export type SkladSkuMeta = {
  status: SkladSkuStatus;
  note?: string;
  /** Kanonický produkt z XLS Sklad_sumár */
  physicalProductKey?: string;
};

/** Statická mapa — aktualizovať po potvrdení od Zuzky C. */
export const SKLAD_SKU_META: Record<string, SkladSkuMeta> = {
  "PH+-B1-C-1": {
    status: "active",
    note: "Predajný Phase+ (Very Berry) — Shopify SKU",
    physicalProductKey: "phase_plus_berry",
  },
  "PH-B1-A": {
    status: "active",
    note: "Phase bez fytoestrogénov (Ananás)",
    physicalProductKey: "phase_ananas",
  },
  "PH+-B1-C": {
    status: "deprecated",
    note: "Phase+ Citron — vypredaný mesiace, v Shopify mŕtvy sklad",
    physicalProductKey: "phase_plus_citron",
  },
  "PH+-B1-VB": {
    status: "inactive",
    note: "Nepoužívať — fyzicky 0 ks, Shopify neaktuálny",
    physicalProductKey: "phase_plus_berry",
  },
  "PH+-B1-C-2": {
    status: "inactive",
    note: "Vypredaný variant",
  },
};

export function skladSkuMeta(sku: string | null | undefined): SkladSkuMeta | null {
  const key = (sku ?? "").trim();
  if (!key) return null;
  return SKLAD_SKU_META[key] ?? null;
}

export function isActiveSkladSku(sku: string | null | undefined): boolean {
  const m = skladSkuMeta(sku);
  return !m || m.status === "active";
}

export function skladSkuStatusLabel(status: SkladSkuStatus): string {
  switch (status) {
    case "active":
      return "Aktívny";
    case "deprecated":
      return "Zastaraný";
    case "inactive":
      return "Neaktívny";
  }
}
