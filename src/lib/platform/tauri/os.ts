import { locale } from "@tauri-apps/plugin-os";
import type { OSAdapter } from "../types";

export const tauriOS: OSAdapter = {
  async locale(): Promise<string | null> {
    return locale();
  },
};
