/**
 * Potvrdený fyzický sklad + pending Orin — odpoveď Zuzky (4. 9. 2026).
 * EuShipments = e-shop; Lazaretská je malý buffer mimo Shopify sync.
 */

export type ConfirmedLocationStock = {
  eushipments: number;
  lazaretska: number;
};

export type ConfirmedProductStock = {
  product_key: string;
  product_label: string;
  locations: ConfirmedLocationStock;
};

export type PendingOrinLine = {
  product_key: string;
  product_label: string;
  qty: number;
};

export type PendingOrinOrder = {
  eta: string; // YYYY-MM-DD
  invoiceDue: string; // YYYY-MM-DD
  note: string;
  lines: PendingOrinLine[];
};

/** Dátum potvrdenia inventúry. */
export const SKLAD_CONFIRMED_AS_OF = "2026-09-04";

export const SKLAD_CONFIRMED_STOCK: ConfirmedProductStock[] = [
  {
    product_key: "phase_plus_citron",
    product_label: "PHASE PLUS - Citrón",
    locations: { eushipments: 0, lazaretska: 6 },
  },
  {
    product_key: "phase_plus_berry",
    product_label: "PHASE PLUS - Very Berry",
    locations: { eushipments: 221, lazaretska: 7 },
  },
  {
    product_key: "phase_ananas",
    product_label: "PHASE - Ananás",
    locations: { eushipments: 1207, lazaretska: 6 },
  },
];

export const PENDING_ORIN_ORDER: PendingOrinOrder = {
  eta: "2026-09-11",
  invoiceDue: "2026-10-11",
  note:
    "Výroba expeduje už 9. 9.; naskladnenie + zverejnenie v e-shope cca 11. 9. (Berry + Citron). Splatnosť ~30 dní od výroby (pôvodne cca 11. 10., môže ísť o pár dní skôr).",
  lines: [
    {
      product_key: "phase_plus_berry",
      product_label: "PHASE PLUS - Very Berry",
      qty: 300,
    },
    {
      product_key: "phase_plus_citron",
      product_label: "PHASE PLUS - Citrón",
      qty: 300,
    },
  ],
};

export function confirmedTotal(locations: ConfirmedLocationStock): number {
  return locations.eushipments + locations.lazaretska;
}

export function pendingQtyForProduct(productKey: string): number {
  return PENDING_ORIN_ORDER.lines
    .filter((l) => l.product_key === productKey)
    .reduce((s, l) => s + l.qty, 0);
}
