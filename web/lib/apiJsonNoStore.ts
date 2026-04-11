/** Zabráni CDN/prehliadaču držať starú JSON odpoveď (lastSyncAt, KPI po synce). */
export const jsonNoStoreHeaders: Record<string, string> = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
};
