/** Shopify SKU status — potvrdené so Zuzkou (4. 9. 2026). */

export type SkladSkuStatus = "active" | "inactive" | "deprecated";

export type SkladSkuMeta = {
  status: SkladSkuStatus;
  note?: string;
  /** Kanonický produkt (EuShipments / XLS) */
  physicalProductKey?: string;
};

/**
 * EuShipments = e-shop. Aktívny predaj: Berry (C-1) + Ananás (PH-B1-A).
 * Citron v e-shope 0; mŕtve Shopify SKU C / VB treba vynulovať.
 */
export const SKLAD_SKU_META: Record<string, SkladSkuMeta> = {
  "PH+-B1-C-1": {
    status: "active",
    note: "Phase+ Very Berry — jediný aktívny Phase+ v e-shope",
    physicalProductKey: "phase_plus_berry",
  },
  "PH-B1-A": {
    status: "active",
    note: "Phase Ananás",
    physicalProductKey: "phase_ananas",
  },
  "PH+-B1-C": {
    status: "deprecated",
    note: "Starý SKU — e-shop Citron = 0; Shopify ešte ukazuje mŕtvy sklad",
    physicalProductKey: "phase_plus_citron",
  },
  "PH+-B1-VB": {
    status: "inactive",
    note: "Nepoužívať — e-shop Berry ide cez PH+-B1-C-1",
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
