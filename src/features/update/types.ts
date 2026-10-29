import type { BundleType, UpdateFailureReason } from "@/lib/platform/types";

export type UpdatePhase =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "downloading"; received: number; total?: number }
  /** Linux: the new Release is installed and runs at the next launch. */
  | { phase: "installed" }
  | { phase: "restarting" }
  | { phase: "failed"; reason: UpdateFailureReason };

export type { BundleType, UpdateFailureReason };
