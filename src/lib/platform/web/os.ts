import type { OSAdapter } from "../types";

export const webOS: OSAdapter = {
  async locale(): Promise<string | null> {
    return navigator.language || null;
  },
};
