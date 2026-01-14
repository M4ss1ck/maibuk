/**
 * Plugin Manager
 *
 * Central singleton that orchestrates plugin lifecycle:
 * - Loading and unloading plugins
 * - Providing API bridges to plugins
 * - Managing plugin events
 * - Handling errors and isolation
 */

import type { Editor } from "@tiptap/core";
import type {
  InstalledPlugin,
  PluginAPI,
  PluginExports,
} from "../types";
import { usePluginStore, loadPluginCode } from "../store";
import { PluginSandbox } from "../security/PluginSandbox";
import { getPermissionManager } from "../security/PermissionManager";
import {
  createPluginAPIBridge,
  cleanupPluginAPI,
  getEventBus,
  GlobalEvents,
} from "../api";

/**
 * Execution mode for plugins
 */
type ExecutionMode = "sandbox" | "direct";

/**
 * Default execution mode - use sandbox for security
 */
const DEFAULT_EXECUTION_MODE: ExecutionMode = "sandbox";

/**
 * Loaded plugin instance with runtime state
 */
interface LoadedPlugin {
  plugin: InstalledPlugin;
  exports: PluginExports;
  api: PluginAPI;
  sandbox: PluginSandbox | null;
  unsubscribers: Array<() => void>;
}


/**
 * Plugin Manager Singleton
 */
export class PluginManager {
  private static instance: PluginManager | null = null;

  private loadedPlugins: Map<string, LoadedPlugin> = new Map();
  private editor: Editor | null = null;

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): PluginManager {
    if (!PluginManager.instance) {
      PluginManager.instance = new PluginManager();
    }
    return PluginManager.instance;
  }

  /**
   * Reset the singleton (for testing)
   */
  static reset(): void {
    if (PluginManager.instance) {
      PluginManager.instance.unloadAllPlugins();
      PluginManager.instance = null;
    }
  }

  /**
   * Set the editor instance for plugins to use
   */
  setEditor(editor: Editor | null): void {
    this.editor = editor;

    // Notify loaded plugins that editor is available
    if (editor) {
      getEventBus().emit(GlobalEvents.EDITOR_READY, editor);
    }
  }

  /**
   * Get the current editor instance
   */
  getEditor(): Editor | null {
    return this.editor;
  }

  /**
   * Initialize the plugin system and load enabled plugins
   */
  async initialize(): Promise<void> {
    const store = usePluginStore.getState();

    if (store.initialized) {
      return;
    }

    // Load all enabled plugins
    const enabledPlugins = store.getEnabledPlugins();

    for (const plugin of enabledPlugins) {
      try {
        await this.loadPlugin(plugin);
      } catch (error) {
        console.error(`Failed to load plugin ${plugin.id}:`, error);
        store.reportError({
          pluginId: plugin.id,
          error: error instanceof Error ? error.message : "Failed to load plugin",
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    }

    store.setInitialized(true);
  }

  /**
   * Load a plugin
   */
  async loadPlugin(
    plugin: InstalledPlugin,
    mode: ExecutionMode = DEFAULT_EXECUTION_MODE
  ): Promise<void> {
    if (!plugin.enabled) {
      console.warn(`Plugin ${plugin.id} is not enabled`);
      return;
    }

    if (this.loadedPlugins.has(plugin.id)) {
      console.warn(`Plugin ${plugin.id} is already loaded`);
      return;
    }

    // Verify all required permissions are granted
    const permissionManager = getPermissionManager();
    if (!permissionManager.hasAllRequiredPermissions(plugin.id)) {
      const missing = permissionManager.getMissingPermissions(plugin.id);
      throw new Error(
        `Plugin ${plugin.id} is missing required permissions: ${missing.join(", ")}`
      );
    }

    // Load plugin code
    const code = await loadPluginCode(plugin.id);
    if (!code) {
      throw new Error(`Plugin code not found for ${plugin.id}`);
    }

    // Create API bridge
    const api = this.createAPIBridge(plugin);

    // Execute plugin code (with or without sandbox)
    let exports: PluginExports;
    let sandbox: PluginSandbox | null = null;

    if (mode === "sandbox") {
      // Create sandboxed environment
      sandbox = new PluginSandbox(plugin.id, plugin.grantedPermissions);
      try {
        exports = await sandbox.execute(code, api);
      } catch (error) {
        sandbox.destroy();
        throw error;
      }
    } else {
      // Direct execution (less secure, for development/testing)
      exports = await this.executePluginCodeDirect(plugin.id, code, api);
    }

    // Store loaded plugin
    const loadedPlugin: LoadedPlugin = {
      plugin,
      exports,
      api,
      sandbox,
      unsubscribers: [],
    };
    this.loadedPlugins.set(plugin.id, loadedPlugin);

    // Mark extension as loaded in store
    usePluginStore.getState().markExtensionLoaded(plugin.id);

    // Call onLoad lifecycle hook
    if (exports.onLoad) {
      try {
        await exports.onLoad(api);
      } catch (error) {
        console.error(`Plugin ${plugin.id} onLoad error:`, error);
        usePluginStore.getState().reportError({
          pluginId: plugin.id,
          error: `onLoad failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    console.log(`Plugin ${plugin.id} loaded successfully (mode: ${mode})`);
  }

  /**
   * Unload a plugin
   */
  async unloadPlugin(pluginId: string): Promise<void> {
    const loaded = this.loadedPlugins.get(pluginId);
    if (!loaded) {
      return;
    }

    // Call onUnload lifecycle hook
    if (loaded.exports.onUnload) {
      try {
        await loaded.exports.onUnload();
      } catch (error) {
        console.error(`Plugin ${pluginId} onUnload error:`, error);
      }
    }

    // Clean up subscriptions
    loaded.unsubscribers.forEach((unsub) => {
      try {
        unsub();
      } catch (e) {
        // Ignore cleanup errors
      }
    });

    // Destroy sandbox if it exists
    if (loaded.sandbox) {
      loaded.sandbox.destroy();
    }

    // Clean up API resources (UI registry, events, etc.)
    cleanupPluginAPI(pluginId);

    // Remove from loaded plugins
    this.loadedPlugins.delete(pluginId);

    // Mark extension as unloaded in store
    usePluginStore.getState().markExtensionUnloaded(pluginId);

    console.log(`Plugin ${pluginId} unloaded`);
  }

  /**
   * Unload all plugins
   */
  async unloadAllPlugins(): Promise<void> {
    const pluginIds = Array.from(this.loadedPlugins.keys());

    for (const id of pluginIds) {
      await this.unloadPlugin(id);
    }
  }

  /**
   * Reload a plugin
   */
  async reloadPlugin(pluginId: string): Promise<void> {
    await this.unloadPlugin(pluginId);

    const plugin = usePluginStore.getState().getPlugin(pluginId);
    if (plugin && plugin.enabled) {
      await this.loadPlugin(plugin);
    }
  }

  /**
   * Get a loaded plugin's exports
   */
  getPluginExports(pluginId: string): PluginExports | null {
    return this.loadedPlugins.get(pluginId)?.exports ?? null;
  }

  /**
   * Get a loaded plugin's TipTap extension
   */
  getPluginExtension(pluginId: string): unknown | null {
    const exports = this.getPluginExports(pluginId);
    return exports?.extension ?? null;
  }

  /**
   * Get all loaded TipTap extensions
   */
  getAllPluginExtensions(): Array<{ pluginId: string; extension: unknown }> {
    const extensions: Array<{ pluginId: string; extension: unknown }> = [];

    for (const [pluginId, loaded] of this.loadedPlugins) {
      if (loaded.exports.extension) {
        extensions.push({
          pluginId,
          extension: loaded.exports.extension,
        });
      }
    }

    return extensions;
  }

  /**
   * Check if a plugin is loaded
   */
  isPluginLoaded(pluginId: string): boolean {
    return this.loadedPlugins.has(pluginId);
  }

  /**
   * Execute plugin code directly (without sandbox)
   *
   * WARNING: This is less secure and should only be used for development/testing.
   * In production, use the sandbox execution mode.
   */
  private async executePluginCodeDirect(
    pluginId: string,
    code: string,
    api: PluginAPI
  ): Promise<PluginExports> {
    try {
      // Wrap the code to capture exports
      const wrappedCode = `
        "use strict";
        const exports = {};
        const module = { exports };

        // Plugin API is available as 'maibuk'
        const maibuk = this.api;

        ${code}

        return module.exports || exports;
      `;

      // Execute with the API context
      const executor = new Function(wrappedCode);
      const exports = executor.call({ api }) as PluginExports;

      return exports;
    } catch (error) {
      throw new Error(
        `Failed to execute plugin ${pluginId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Create the API bridge for a plugin based on its permissions
   */
  private createAPIBridge(plugin: InstalledPlugin): PluginAPI {
    const self = this;
    return createPluginAPIBridge({
      plugin,
      getEditor: () => self.editor,
    });
  }
}

/**
 * Get the plugin manager singleton
 */
export function getPluginManager(): PluginManager {
  return PluginManager.getInstance();
}
