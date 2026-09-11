/** User-facing label for P&L methodology note (from API `meta.note`). */
export function formatHybridPnlNote(note: string): string {
  return note
    .replace(/^Hybrid:\s*/i, "XLS · reálne COGS: ")
    .replace(/^Hybridný model:\s*/i, "XLS · reálne COGS: ");
}
