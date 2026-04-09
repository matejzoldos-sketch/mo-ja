/** Formát času posledného úspešného syncu (Shopify → Supabase). */
export function formatLastSyncDisplay(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return new Intl.DateTimeFormat("sk-SK", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Europe/Bratislava",
    }).format(d);
  } catch {
    return String(iso);
  }
}
