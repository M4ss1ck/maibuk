/**
 * One Plugin's side of the real broker over the real handlers, for suites that
 * prove what a Plugin call does to the Library. The SDK client sends over a
 * MessageChannel the way a Plugin does, so the row's Plugin Permission, input
 * schema, and Library availability checks run before the handler, exactly as
 * they do in the app.
 */

import { createPluginBroker } from "@/features/plugins/broker";
import { createPluginHandlers } from "@/features/plugins/handlers";
import type { PluginManifest, PluginPermissionId } from "@/features/plugins/types";
import { createPluginClient, type PluginClient } from "@/plugin-sdk";
import { PLUGIN_MANIFEST } from "@/test/support/plugin-fixtures";

/** The manifest a Plugin writing to the Library declares, so the broker can refuse it. */
export const LIBRARY_WRITE_MANIFEST: PluginManifest = {
  ...PLUGIN_MANIFEST,
  permissions: { required: ["library:read", "library:write"], optional: [] },
};

export interface ConnectedPlugin {
  client: PluginClient;
  close: () => void;
}

export function connectPluginBroker(options: {
  manifest: PluginManifest;
  /** Every Plugin Permission the manifest declares, required and optional. */
  declared: readonly PluginPermissionId[];
  /** The Plugin Permissions granted right now; read on every call. */
  granted: () => Iterable<PluginPermissionId>;
  /** False while the Library cannot be read or written; defaults to available. */
  isLibraryAvailable?: () => boolean;
  /** Registers a `requiresLibrary` handler's work so the Tutorial switch settles it. */
  trackLibraryWork?: <T>(work: Promise<T>) => Promise<T>;
}): ConnectedPlugin {
  const channel = new MessageChannel();
  createPluginBroker({
    pluginId: options.manifest.id,
    port: channel.port1,
    declared: options.declared,
    granted: options.granted,
    isLibraryAvailable: options.isLibraryAvailable ?? (() => true),
    ...(options.trackLibraryWork === undefined
      ? {}
      : { trackLibraryWork: options.trackLibraryWork }),
    handlers: createPluginHandlers(options.manifest),
  });
  const client = createPluginClient(channel.port2);
  return {
    client,
    close() {
      channel.port1.close();
      channel.port2.close();
    },
  };
}

/** A Library Plugin with the given Permissions granted, over the same broker. */
export function connectLibraryWritePlugin(options: {
  granted: readonly PluginPermissionId[];
  isLibraryAvailable?: () => boolean;
}): ConnectedPlugin {
  return connectPluginBroker({
    manifest: LIBRARY_WRITE_MANIFEST,
    declared: ["library:read", "library:write"],
    granted: () => options.granted,
    ...(options.isLibraryAvailable === undefined
      ? {}
      : { isLibraryAvailable: options.isLibraryAvailable }),
  });
}
