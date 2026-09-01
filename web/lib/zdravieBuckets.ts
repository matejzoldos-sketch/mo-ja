import { OWNER_WITHDRAWAL_LABEL } from "./cashflowOwner";

export type ZdravieCostMix = {
  cogs: number;
  marketing: number;
  staff: number;
  otherOpex: number;
};

export type ZdravieBucket = {
  key: string;
  label: string;
  color: string;
  amount: number;
  kind: "pnl" | "cash";
  pctOfCosts: number | null;
  pctOfRevenue: number | null;
  action: string;
  actionCrit: boolean;
  benchLabel: string;
};

function pct(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || Math.abs(whole) < 0.005) {
    return null;
  }
  return part / whole;
}

function inBand(p: number | null, min: number, max: number): boolean {
  if (p == null) return true;
  const x = p * 100;
  return x >= min && x <= max;
}

export function buildZdravieCostBuckets(input: {
  costMix: ZdravieCostMix;
  revenueYtd: number;
  ownerWithdrawalsYtd: number;
  orinPurchasesYtd: number;
  currentBalance: number;
  bufferEur?: number;
}): {
  buckets: ZdravieBucket[];
  pnlTotal: number;
  revenueYtd: number;
  costsOverRevenue: boolean;
  costsOverPct: number | null;
} {
  const buffer = input.bufferEur ?? 3000;
  const rev = input.revenueYtd;
  const { cogs, marketing, staff, otherOpex } = input.costMix;
  const pnlTotal = cogs + marketing + staff + otherOpex;

  const cogsPct = pct(cogs, rev);
  const mktPct = pct(marketing, rev);
  const staffPct = pct(staff, rev);
  const opexOtherPct = pct(otherOpex, rev);
  const ownerPct = pct(input.ownerWithdrawalsYtd, rev);
  const orinPct = pct(input.orinPurchasesYtd, rev);

  const cogsCrit = cogsPct != null && cogsPct * 100 > 55;
  const mktCrit = mktPct != null && mktPct * 100 > 30;
  const staffCrit = staffPct != null && staffPct * 100 > 35;
  const otherCrit = opexOtherPct != null && opexOtherPct * 100 > 20;
  const ownerCrit =
    input.ownerWithdrawalsYtd > 0 &&
    (input.currentBalance < buffer ||
      (ownerPct != null && ownerPct * 100 > 15));
  const orinCrit =
    input.orinPurchasesYtd > 0 && input.currentBalance < buffer;

  const pnlRows: ZdravieBucket[] = (
    [
      {
        key: "cogs",
        label: "COGS (42 % tovar)",
        color: "hsla(12, 55%, 48%, 0.9)",
        amount: cogs,
        kind: "pnl" as const,
        pctOfCosts: pct(cogs, pnlTotal),
        pctOfRevenue: cogsPct,
        benchLabel: "30–55 % tržieb",
        actionCrit: cogsCrit,
        action: cogsCrit
          ? "COGS nad benchmarkom — skontrolovať mix SKU a Orin unit cost"
          : inBand(cogsPct, 30, 55)
            ? "Držať COGS pri ~42 % čistých tržieb za tovar (Orin)"
            : "COGS pod pásmom — overiť, či XLS goods revenue sedí",
      },
      {
        key: "marketing",
        label: "Marketing",
        color: "hsla(210, 42%, 48%, 0.9)",
        amount: marketing,
        kind: "pnl" as const,
        pctOfCosts: pct(marketing, pnlTotal),
        pctOfRevenue: mktPct,
        benchLabel: "10–30 % tržieb",
        actionCrit: mktCrit,
        action: mktCrit
          ? "Zmraziť Meta spend, kým UTM ROAS / MER nie sú v cieli (/scaling)"
          : mktPct != null && mktPct * 100 < 10
            ? "Marketing pod 10 % — overiť, či nebrzdí rast"
            : "Revízia kampaní podľa MER a Real ROAS na /marketing a /scaling",
      },
      {
        key: "staff",
        label: "Staff",
        color: "hsla(32, 60%, 45%, 0.9)",
        amount: staff,
        kind: "pnl" as const,
        pctOfCosts: pct(staff, pnlTotal),
        pctOfRevenue: staffPct,
        benchLabel: "15–35 % tržieb",
        actionCrit: staffCrit,
        action: staffCrit
          ? "Staff nad 35 % tržieb — zosúladiť kapacitu s tempom predaja"
          : "Kapacita vs. tempo predaja; Pupops/agentúry držať oddelene v /pnl",
      },
      {
        key: "other_opex",
        label: "Ostatný OPEX",
        color: "hsla(220, 18%, 52%, 0.9)",
        amount: otherOpex,
        kind: "pnl" as const,
        pctOfCosts: pct(otherOpex, pnlTotal),
        pctOfRevenue: opexOtherPct,
        benchLabel: "5–20 % tržieb",
        actionCrit: otherCrit,
        action: otherCrit
          ? "Revízia zmlúv (logistika, IT, externé služby, nájom)"
          : "Bežná prevádzka — raz za štvrťrok prejsť top dodávateľov",
      },
    ] satisfies ZdravieBucket[]
  ).filter((b) => b.amount > 0.5);

  const cashRows: ZdravieBucket[] = (
    [
      {
        key: "owner",
        label: `${OWNER_WITHDRAWAL_LABEL} (cash)`,
        color: "hsla(0, 55%, 46%, 0.9)",
        amount: input.ownerWithdrawalsYtd,
        kind: "cash" as const,
        pctOfCosts: null,
        pctOfRevenue: ownerPct,
        benchLabel: "cash páka",
        actionCrit: ownerCrit,
        action: ownerCrit
          ? "Zmraziť výbery Petra Škutila, kým zostatok nie je nad vankúšom 3 000 €"
          : input.ownerWithdrawalsYtd > 0.5
            ? "Udržať výbery Petra Škutila pod H1 tempom; scenár bez výberov na runway"
            : "Žiadne výbery Petra Škutila v období — OK",
      },
      {
        key: "orin",
        label: "Nákupy ORIN (cash)",
        color: "hsla(28, 65%, 48%, 0.9)",
        amount: input.orinPurchasesYtd,
        kind: "cash" as const,
        pctOfCosts: null,
        pctOfRevenue: orinPct,
        benchLabel: "cash páka",
        actionCrit: orinCrit,
        action: orinCrit
          ? "Ďalšiu faktúru ORIN odložiť — cash pod vankúšom 3 000 €"
          : input.orinPurchasesYtd > 0.5
            ? "Nákupy viazať na cash buffer; v P&L ide do COGS neskôr"
            : "Žiadne ORIN pohyby v období",
      },
    ] satisfies ZdravieBucket[]
  ).filter((b) => b.amount > 0.5);

  const costsOverPct = pct(pnlTotal, rev);
  const costsOverRevenue =
    costsOverPct != null && costsOverPct * 100 > 100.05;

  return {
    buckets: [...pnlRows, ...cashRows],
    pnlTotal,
    revenueYtd: rev,
    costsOverRevenue,
    costsOverPct,
  };
}
