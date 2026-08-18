/** PostgREST / Postgres chyby → stručná správa pre UI (bez úniku schémy). */
export function formatRpcError(raw: string, label?: string): string {
  const prefix = label ? `[${label}] ` : "";
  const text = (raw || "").trim();
  if (text) {
    console.error(`${prefix}${text.slice(0, 2000)}`);
  }

  const lower = text.toLowerCase();
  if (
    text.includes("57014") ||
    lower.includes("statement timeout") ||
    lower.includes("the operation was aborted") ||
    lower.includes("aborted due to timeout")
  ) {
    return `${prefix}Dotaz v databáze trval príliš dlho. Skús neskôr alebo kratšie obdobie.`;
  }

  return `${prefix}Načítanie dát zlyhalo. Skús obnoviť stránku.`;
}

export const MISSING_SUPABASE_CONFIG =
  "Chýba konfigurácia databázy. Skontroluj prostredie a skús znova.";
