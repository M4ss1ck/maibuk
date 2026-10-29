import type { UpdatePhase } from "@/features/update/types";

/** The download as 0 to 100, or null when no download runs or its size is unknown (an indeterminate bar). */
export function updateProgressPercent(state: UpdatePhase): number | null {
  if (state.phase !== "downloading" || !state.total) return null;
  return Math.min(100, (state.received / state.total) * 100);
}
