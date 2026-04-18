/**
 * Convert an RMS dBFS value into a 0..1 bar level for visualization.
 *
 * We clamp to [-60 dB .. 0 dB]. -60 dB ≈ silence on most speakers. Below that, the bar
 * stays at 0 instead of disappearing into log-space noise.
 */
export const RMS_FLOOR_DB = -60;
export const RMS_CEILING_DB = 0;

export function rmsDbToBarLevel(rmsDb: number): number {
  if (!Number.isFinite(rmsDb)) return 0;
  if (rmsDb <= RMS_FLOOR_DB) return 0;
  if (rmsDb >= RMS_CEILING_DB) return 1;
  return (rmsDb - RMS_FLOOR_DB) / (RMS_CEILING_DB - RMS_FLOOR_DB);
}
