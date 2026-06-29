import type { OSAdapter } from "@/lib/platform/types";

export const webOS: OSAdapter = {
  async locale(): Promise<string | null> {
    return navigator.language || null;
  },
};
