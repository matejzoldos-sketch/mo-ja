/** PostgREST / Postgres chyby → stručná správa pre UI. */
export function formatRpcError(raw: string, label?: string): string {
  const prefix = label ? `[${label}] ` : "";
  const text = (raw || "").trim();
  if (!text) return `${prefix}Chyba databázy.`;

  try {
    const parsed = JSON.parse(text) as { message?: string; code?: string };
    if (parsed.code === "57014" || (parsed.message || "").includes("statement timeout")) {
      return `${prefix}Dotaz v databáze trval príliš dlho. Skús neskôr alebo kratšie obdobie.`;
    }
    if (parsed.message) return `${prefix}${parsed.message}`;
  } catch {
    /* not JSON */
  }

  if (text.includes("57014") || text.toLowerCase().includes("statement timeout")) {
    return `${prefix}Dotaz v databáze trval príliš dlho. Skús neskôr alebo kratšie obdobie.`;
  }

  return `${prefix}${text.slice(0, 400)}`;
}
