import { displayCounterparty, type CashflowEnrichedTx } from "./cashflowPie";

/** Kategória v tabuľke pohybov / jednotlivý výber. */
export const OWNER_WITHDRAWAL_LABEL = "Výber Peter Škutil";

/** KPI a súhrny YTD. */
export const OWNER_WITHDRAWALS_YTD_LABEL = "Výbery Peter Škutil YTD";

/** Runway scenár bez ďalších platieb konateľovi. */
export const OWNER_WITHDRAWALS_FREEZE_LABEL =
  "Bez ďalších výberov Petra Škutila";

const OWNER_NAME_HINTS = [
  "peter škutil",
  "peter skutil",
  "škutil",
  "skutil",
];

function stripDiacritics(s: string): string {
  const map: Record<string, string> = {
    á: "a",
    ä: "a",
    č: "c",
    ď: "d",
    é: "e",
    í: "i",
    ĺ: "l",
    ľ: "l",
    ň: "n",
    ó: "o",
    ô: "o",
    ö: "o",
    ŕ: "r",
    š: "s",
    ť: "t",
    ú: "u",
    ü: "u",
    ý: "y",
    ž: "z",
  };
  return s
    .split("")
    .map((ch) => map[ch] ?? map[ch.toLowerCase()] ?? ch)
    .join("");
}

/** Súkromný výber / platby konateľovi Peterovi Škutilovi (nie OPEX, nie P&L). */
export function isOwnerWithdrawal(tx: CashflowEnrichedTx): boolean {
  if (!(tx.amount < 0)) return false;
  const label = displayCounterparty(tx).toLowerCase();
  const flat = stripDiacritics(label);
  return OWNER_NAME_HINTS.some(
    (h) => flat.includes(stripDiacritics(h)) || label.includes(h)
  );
}
