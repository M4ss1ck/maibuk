// A Built-in Plugin fixture whose manifest declares desktop only, so the build
// omits it on every other target. Never shipped; only the build test reads it.
import { createPluginClient } from "@/plugin-sdk";

export const start = (port: Parameters<typeof createPluginClient>[0]): void => {
  createPluginClient(port);
};
