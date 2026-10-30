import { create } from "zustand";
import { getUpdater, UpdateError } from "@/lib/platform";
import type { UpdateProgressEvent, UpdaterAdapter } from "@/lib/platform";
import { compareReleaseNumbers } from "@/features/releases/compare";
import { runShutdown } from "@/lib/window/shutdown";
import type { BundleType, UpdatePhase } from "@/features/update/types";

interface UpdateState {
  bundleType: BundleType;
  state: UpdatePhase;
  /** Read once at startup; `unknown` until then, so no Update UI shows early. */
  loadBundleType: () => Promise<void>;
  /** Download `release`, and install it on Linux. A second call while one is in flight does nothing. */
  start: (release: string) => Promise<void>;
  /**
   * Restart now (Linux, `installed`) or Restart to update (Windows,
   * `downloaded`), after the shutdown routine. A failed Flush keeps the app
   * running; a failed Windows install becomes `failed`.
   */
  restart: () => Promise<void>;
  /** Windows Later: drops the download; the Update is offered again. */
  discardDownload: () => Promise<void>;
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

// Phases a click on Update must not interrupt: running, or done and waiting for a restart.
const BUSY = new Set<UpdatePhase["phase"]>([
  "checking",
  "downloading",
  "installed",
  "downloaded",
  "restarting",
]);

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
    if (BUSY.has(get().state.phase)) return;
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
      const onProgress = (event: UpdateProgressEvent) => {
        if (event.kind === "started") total = event.total;
        else if (event.kind === "progress") received += event.bytes;
        else return;
        set({ state: { phase: "downloading", received, total } });
      };
      // The NSIS installer quits the app, so Windows installs only on Restart
      // to update; Linux installs as soon as the bytes arrive (ADR 0037).
      if (get().bundleType === "nsis") {
        await updater.download(onProgress);
        set({ state: { phase: "downloaded" } });
      } else {
        await updater.downloadAndInstall(onProgress);
        set({ state: { phase: "installed" } });
      }
    } catch (error) {
      const reason = error instanceof UpdateError ? error.reason : "other";
      set({ state: { phase: "failed", reason } });
    }
  },
  async restart() {
    const { phase } = get().state;
    if (phase !== "installed" && phase !== "downloaded") return;
    set({ state: { phase: "restarting" } });
    try {
      if (phase === "installed") {
        await runShutdown("restart");
        return;
      }
      const updater = await resolveUpdater();
      await runShutdown("install", {
        install: async () => {
          try {
            await updater.install();
          } catch (error) {
            throw error instanceof UpdateError ? error : new UpdateError("other", error);
          }
        },
      });
    } catch (error) {
      // The install step rejects with an UpdateError; anything else is the
      // Flush, which stops the routine before it installs or restarts.
      if (error instanceof UpdateError) set({ state: { phase: "failed", reason: error.reason } });
      else set({ state: { phase, notSaved: true } });
    }
  },
  async discardDownload() {
    if (get().state.phase !== "downloaded") return;
    set({ state: { phase: "idle" } });
    const updater = await resolveUpdater();
    await updater.close().catch(() => {});
  },
}));

export function resetUpdateStoreForTests(): void {
  useUpdateStore.setState({ bundleType: "unknown", state: { phase: "idle" } });
}
