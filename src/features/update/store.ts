import { create } from "zustand";
import { getUpdater, UpdateError } from "@/lib/platform";
import type { UpdaterAdapter } from "@/lib/platform";
import { compareReleaseNumbers } from "@/features/releases/compare";
import { runShutdown } from "@/lib/window/shutdown";
import type { BundleType, UpdatePhase } from "@/features/update/types";

interface UpdateState {
  bundleType: BundleType;
  state: UpdatePhase;
  /** Read once at startup; `unknown` until then, so no Update UI shows early. */
  loadBundleType: () => Promise<void>;
  /** Download and install `release`. A second call while one is in flight does nothing. */
  start: (release: string) => Promise<void>;
  /** Restart now, after the shutdown routine. A failed Flush keeps the app running. */
  restart: () => Promise<void>;
}

let seamUpdater: UpdaterAdapter | null = null;

/** The E2E lane's adapter (`e2e-seam.ts`); a shipped build never sets it. */
export function setSeamUpdater(adapter: UpdaterAdapter | null): void {
  seamUpdater = adapter;
}

const resolveUpdater = async (): Promise<UpdaterAdapter> => seamUpdater ?? getUpdater();

/** Whether a click on Update (or the Command) may begin one. */
export function canStartUpdate(state: UpdatePhase): boolean {
  return state.phase === "idle" || state.phase === "failed";
}

const IN_FLIGHT = new Set<UpdatePhase["phase"]>(["checking", "downloading", "restarting"]);

export const useUpdateStore = create<UpdateState>()((set, get) => ({
  bundleType: "unknown",
  state: { phase: "idle" },
  async loadBundleType() {
    try {
      const updater = await resolveUpdater();
      set({ bundleType: await updater.bundleType() });
    } catch {
      set({ bundleType: "unknown" });
    }
  },
  async start(release) {
    if (IN_FLIGHT.has(get().state.phase) || get().state.phase === "installed") return;
    set({ state: { phase: "checking" } });
    try {
      const updater = await resolveUpdater();
      const found = await updater.check();
      // The Release check decides what is newer (ADR 0037); a feed without
      // that Release for this format sends the author to the Download Page.
      if (!found || compareReleaseNumbers(found.version, release) < 0) {
        set({ state: { phase: "failed", reason: "no-asset" } });
        return;
      }
      let received = 0;
      let total: number | undefined;
      set({ state: { phase: "downloading", received, total } });
      await updater.downloadAndInstall((event) => {
        if (event.kind === "started") total = event.total;
        else if (event.kind === "progress") received += event.bytes;
        else return;
        set({ state: { phase: "downloading", received, total } });
      });
      set({ state: { phase: "installed" } });
    } catch (error) {
      const reason = error instanceof UpdateError ? error.reason : "other";
      set({ state: { phase: "failed", reason } });
    }
  },
  async restart() {
    if (get().state.phase !== "installed") return;
    set({ state: { phase: "restarting" } });
    try {
      await runShutdown("restart");
    } catch {
      set({ state: { phase: "installed" } });
    }
  },
}));

export function resetUpdateStoreForTests(): void {
  useUpdateStore.setState({ bundleType: "unknown", state: { phase: "idle" } });
}
