import type { UpdaterAdapter } from "@/lib/platform/types";

// The web app loads the newest Release already, and Android updates through
// its store, so there is nothing to install (ADR 0037).
export const webUpdater: UpdaterAdapter = {
  async bundleType() {
    return "unknown";
  },
  async check() {
    return null;
  },
  async downloadAndInstall() {},
  async restart() {},
};
