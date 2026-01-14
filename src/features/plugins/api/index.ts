/**
 * Plugin API Module
 *
 * Provides the complete API surface for plugins to interact with Maibuk.
 * Each API is permission-controlled and isolated per plugin.
 */

import type { PluginAPI, InstalledPlugin } from "../types";
import type { Editor } from "@tiptap/core";

// API factories
export {
  createEditorAPI,
  isCommandAllowed,
  getAllowedCommands,
  type EditorAPIOptions,
} from "./EditorAPI";

export {
  createStorageAPI,
  getStorageQuota,
  getStoragePrefix,
  clearPluginStorageData,
  type StorageAPIOptions,
} from "./StorageAPI";

export {
  createUIAPI,
  getUIRegistry,
  clearPluginUI,
  setNotificationHandler,
  setModalHandler,
  type UIAPIOptions,
} from "./UIAPI";

export {
  createEventAPI,
  getEventBus,
  emitGlobalEvent,
  clearPluginEvents,
  GlobalEvents,
  type EventAPIOptions,
} from "./EventAPI";

export {
  createMetadataAPI,
  setBookMetadataProvider,
  setChapterMetadataProvider,
  type MetadataAPIOptions,
  type BookMetadataProvider,
  type ChapterMetadataProvider,
} from "./MetadataAPI";

// Import factories for the bridge
import { createEditorAPI } from "./EditorAPI";
import { createStorageAPI } from "./StorageAPI";
import { createUIAPI } from "./UIAPI";
import { createEventAPI } from "./EventAPI";
import { createMetadataAPI } from "./MetadataAPI";

/**
 * Options for creating a complete plugin API bridge
 */
export interface PluginAPIBridgeOptions {
  plugin: InstalledPlugin;
  getEditor: () => Editor | null;
}

/**
 * Create a complete API bridge for a plugin
 *
 * This is the main factory function that creates all API instances
 * for a plugin based on its granted permissions.
 */
export function createPluginAPIBridge(options: PluginAPIBridgeOptions): PluginAPI {
  const { plugin, getEditor } = options;

  return {
    editor: createEditorAPI({
      pluginId: plugin.id,
      getEditor,
    }),

    storage: createStorageAPI({
      pluginId: plugin.id,
    }),

    ui: createUIAPI({
      pluginId: plugin.id,
    }),

    events: createEventAPI({
      pluginId: plugin.id,
    }),

    metadata: createMetadataAPI({
      pluginId: plugin.id,
    }),
  };
}

/**
 * Clean up all API resources for a plugin
 */
export function cleanupPluginAPI(pluginId: string): void {
  clearPluginUI(pluginId);
  clearPluginEvents(pluginId);
  // Storage cleanup is handled separately during uninstall
}

// Re-export for backwards compatibility
import { clearPluginUI } from "./UIAPI";
import { clearPluginEvents } from "./EventAPI";
