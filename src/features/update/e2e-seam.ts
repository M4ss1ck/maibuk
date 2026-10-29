/**
 * The E2E lane's way to run the What's new Update flow (#661).
 *
 * Playwright drives the production web build, whose updater reports `unknown`
 * and whose Release check never runs, and a real install cannot run under it.
 * `window.__maibukUpdateSeam.arm` hands the app a scripted adapter and a newer
 * Release, so the real dialog, badge, and Command run against it.
 *
 * Nothing here reaches a shipped bundle: `main.tsx` imports it only behind
 * `VITE_E2E_BUILTIN_SEED`, the flag only the E2E lane's build sets.
 */

import { useReleaseStore } from "@/features/releases/store";
import { setSeamUpdater, useUpdateStore } from "@/features/update/store";
import { UpdateError, type BundleType, type UpdateFailureReason } from "@/lib/platform/types";

export interface UpdateSeamScript {
  bundleType: BundleType;
  /** The newer Release the Release check would have found. */
  release: string;
  /** Total bytes the scripted download reports; the bar fills in `steps` steps. */
  total?: number;
  steps?: number;
  failure?: UpdateFailureReason;
}

declare global {
  interface Window {
    __maibukUpdateSeam?: { arm: (script: UpdateSeamScript) => Promise<void> };
  }
}

async function arm(script: UpdateSeamScript): Promise<void> {
  const { total = 100, steps = 4 } = script;
  setSeamUpdater({
    bundleType: async () => script.bundleType,
    check: async () => ({ version: script.release }),
    downloadAndInstall: async (onProgress) => {
      onProgress({ kind: "started", total });
      for (let step = 0; step < steps; step++) {
        onProgress({ kind: "progress", bytes: total / steps });
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      onProgress({ kind: "finished" });
      if (script.failure) throw new UpdateError(script.failure);
    },
    restart: async () => {},
  });
  useReleaseStore.getState().setNewerReleases([
    {
      number: script.release,
      date: "2099-01-01",
      url: `https://github.com/M4ss1ck/maibuk/releases/tag/v${script.release}`,
      sections: [{ kind: "fixed", items: [[{ kind: "text", text: "A scripted Release" }]] }],
    },
  ]);
  await useUpdateStore.getState().loadBundleType();
}

/** Puts the seam on the page. Only the E2E lane's build calls this. */
export function installUpdateSeam(): void {
  window.__maibukUpdateSeam = { arm };
}
