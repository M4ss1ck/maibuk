/**
 * The desktop and Android Plugin Directory adapter. Only Rust lists, reads,
 * hashes, copies, and watches the folder there, and hands the webview the
 * bytes it hashed (ADR 0020); that adapter lands with #435. Until then this
 * one reports an empty directory, so a desktop launch starts no Plugins and
 * behaves exactly as with none installed.
 */

import type { PluginDirectoryAdapter } from "@/lib/platform/types";

export function createTauriPluginDirectory(): PluginDirectoryAdapter {
  return {
    async listFolders(): Promise<string[]> {
      return [];
    },
    async readFolder(): Promise<null> {
      return null;
    },
  };
}
