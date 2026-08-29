/** User-facing label for hybrid P&L methodology (from API `meta.note`). */
export function formatHybridPnlNote(note: string): string {
  return note.replace(/^Hybrid:\s*/i, "Hybridný model: ");
}
