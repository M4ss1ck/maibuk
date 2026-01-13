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
  Permission,
  EditorAPI,
  StorageAPI,
  UIAPI,
  EventAPI,
  MetadataAPI,
  EditorSelection,
  NotificationType,
} from "../types";
import { usePluginStore, loadPluginCode } from "../store";
import { PluginSandbox } from "../security/PluginSandbox";
import { getPermissionManager } from "../security/PermissionManager";

/**
 * Storage quota per plugin (5MB)
 */
const STORAGE_QUOTA = 5 * 1024 * 1024;

/**
 * Plugin storage prefix
 */
const STORAGE_PREFIX = "maibuk-plugin:";

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
 * Event bus for plugin communication
 */
class PluginEventBus {
  private listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map();

  on(event: string, callback: (...args: unknown[]) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  emit(event: string, ...args: unknown[]): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach((callback) => {
        try {
          callback(...args);
        } catch (error) {
          console.error(`Error in event listener for "${event}":`, error);
        }
      });
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

/**
 * Plugin Manager Singleton
 */
export class PluginManager {
  private static instance: PluginManager | null = null;

  private loadedPlugins: Map<string, LoadedPlugin> = new Map();
  private editor: Editor | null = null;
  private eventBus: PluginEventBus = new PluginEventBus();

  // UI callbacks that the app can register
  private showNotification:
    | ((message: string, type: NotificationType) => void)
    | null = null;

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
      this.eventBus.emit("editor:ready", editor);
    }
  }

  /**
   * Get the current editor instance
   */
  getEditor(): Editor | null {
    return this.editor;
  }

  /**
   * Register the notification callback
   */
  setNotificationHandler(
    handler: (message: string, type: NotificationType) => void
  ): void {
    this.showNotification = handler;
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

    this.eventBus.clear();
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
    const permissions = new Set(plugin.grantedPermissions);

    return {
      editor: this.createEditorAPI(plugin.id, permissions),
      storage: this.createStorageAPI(plugin.id, permissions),
      ui: this.createUIAPI(plugin.id, permissions),
      events: this.createEventAPI(plugin.id),
      metadata: this.createMetadataAPI(permissions),
    };
  }

  /**
   * Create Editor API proxy
   */
  private createEditorAPI(
    pluginId: string,
    permissions: Set<Permission>
  ): EditorAPI | null {
    const canRead =
      permissions.has("editor:read") || permissions.has("editor:write");
    const canWrite = permissions.has("editor:write");
    const canCommands = permissions.has("editor:commands");

    if (!canRead && !canWrite) {
      return null;
    }

    const self = this;

    const assertEditor = (): Editor => {
      if (!self.editor) {
        throw new Error("Editor not available");
      }
      return self.editor;
    };

    return {
      getContent(): string {
        return assertEditor().getHTML();
      },

      getText(): string {
        return assertEditor().getText();
      },

      getJSON(): Record<string, unknown> {
        return assertEditor().getJSON();
      },

      getSelection(): EditorSelection | null {
        const editor = assertEditor();
        const { from, to } = editor.state.selection;
        return {
          from,
          to,
          text: editor.state.doc.textBetween(from, to),
        };
      },

      getWordCount(): number {
        const editor = assertEditor();
        return editor.storage.characterCount?.words?.() ?? 0;
      },

      getCharacterCount(): number {
        const editor = assertEditor();
        return editor.storage.characterCount?.characters?.() ?? 0;
      },

      insertText(text: string): boolean {
        if (!canWrite) {
          console.warn(`Plugin ${pluginId} lacks editor:write permission`);
          return false;
        }
        return assertEditor().chain().focus().insertContent(text).run();
      },

      insertHTML(html: string): boolean {
        if (!canWrite) {
          console.warn(`Plugin ${pluginId} lacks editor:write permission`);
          return false;
        }
        return assertEditor().chain().focus().insertContent(html).run();
      },

      replaceSelection(content: string): boolean {
        if (!canWrite) {
          console.warn(`Plugin ${pluginId} lacks editor:write permission`);
          return false;
        }
        return assertEditor()
          .chain()
          .focus()
          .deleteSelection()
          .insertContent(content)
          .run();
      },

      executeCommand(command: string, ...args: unknown[]): boolean {
        if (!canCommands) {
          console.warn(`Plugin ${pluginId} lacks editor:commands permission`);
          return false;
        }

        // Whitelist of allowed commands
        const allowedCommands = [
          "toggleBold",
          "toggleItalic",
          "toggleUnderline",
          "toggleStrike",
          "toggleHighlight",
          "setTextAlign",
          "toggleBulletList",
          "toggleOrderedList",
          "setHeading",
          "toggleBlockquote",
          "setHorizontalRule",
          "undo",
          "redo",
        ];

        if (!allowedCommands.includes(command)) {
          console.warn(`Plugin ${pluginId}: command "${command}" not allowed`);
          return false;
        }

        const editor = assertEditor();
        const cmd = (editor.commands as Record<string, unknown>)[command];
        if (typeof cmd === "function") {
          return (cmd as (...args: unknown[]) => boolean).apply(
            editor.commands,
            args
          );
        }
        return false;
      },

      onUpdate(callback: (content: string) => void): () => void {
        const editor = assertEditor();
        const handler = () => callback(editor.getHTML());
        editor.on("update", handler);
        return () => editor.off("update", handler);
      },

      onSelectionUpdate(
        callback: (selection: EditorSelection) => void
      ): () => void {
        const editor = assertEditor();
        const handler = () => {
          const { from, to } = editor.state.selection;
          callback({
            from,
            to,
            text: editor.state.doc.textBetween(from, to),
          });
        };
        editor.on("selectionUpdate", handler);
        return () => editor.off("selectionUpdate", handler);
      },
    };
  }

  /**
   * Create Storage API proxy
   */
  private createStorageAPI(
    pluginId: string,
    permissions: Set<Permission>
  ): StorageAPI | null {
    if (!permissions.has("storage:local")) {
      return null;
    }

    const prefix = `${STORAGE_PREFIX}${pluginId}:`;

    const getUsage = (): number => {
      let total = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) {
          const value = localStorage.getItem(key);
          if (value) {
            total += new Blob([value]).size;
          }
        }
      }
      return total;
    };

    return {
      async get<T>(key: string): Promise<T | null> {
        const fullKey = prefix + key;
        const value = localStorage.getItem(fullKey);
        return value ? (JSON.parse(value) as T) : null;
      },

      async set<T>(key: string, value: T): Promise<void> {
        const fullKey = prefix + key;
        const serialized = JSON.stringify(value);
        const newSize = new Blob([serialized]).size;
        const currentUsage = getUsage();

        // Subtract existing key size if it exists
        const existingValue = localStorage.getItem(fullKey);
        const existingSize = existingValue
          ? new Blob([existingValue]).size
          : 0;

        if (currentUsage - existingSize + newSize > STORAGE_QUOTA) {
          throw new Error(
            `Storage quota exceeded (${Math.round(STORAGE_QUOTA / 1024)}KB limit)`
          );
        }

        localStorage.setItem(fullKey, serialized);

        // Update usage in store
        usePluginStore
          .getState()
          .updateStorageUsage(pluginId, currentUsage - existingSize + newSize);
      },

      async remove(key: string): Promise<void> {
        const fullKey = prefix + key;
        localStorage.removeItem(fullKey);
        usePluginStore.getState().updateStorageUsage(pluginId, getUsage());
      },

      async clear(): Promise<void> {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key?.startsWith(prefix)) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach((key) => localStorage.removeItem(key));
        usePluginStore.getState().updateStorageUsage(pluginId, 0);
      },

      async keys(): Promise<string[]> {
        const result: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key?.startsWith(prefix)) {
            result.push(key.slice(prefix.length));
          }
        }
        return result;
      },

      getUsage,

      getQuota(): number {
        return STORAGE_QUOTA;
      },
    };
  }

  /**
   * Create UI API proxy
   */
  private createUIAPI(
    pluginId: string,
    permissions: Set<Permission>
  ): UIAPI | null {
    const canNotify = permissions.has("ui:notification");
    const canToolbar = permissions.has("ui:toolbar");
    const canPanel = permissions.has("ui:panel");
    const canModal = permissions.has("ui:modal");

    if (!canNotify && !canToolbar && !canPanel && !canModal) {
      return null;
    }

    const self = this;

    return {
      showNotification(
        message: string,
        type: NotificationType = "info"
      ): void {
        if (!canNotify) {
          console.warn(`Plugin ${pluginId} lacks ui:notification permission`);
          return;
        }

        if (self.showNotification) {
          self.showNotification(message, type);
        } else {
          // Fallback to console
          const logMethod =
            type === "error"
              ? console.error
              : type === "warning"
                ? console.warn
                : console.log;
          logMethod(`[Plugin ${pluginId}] ${message}`);
        }
      },

      showModal(): Promise<unknown> {
        if (!canModal) {
          console.warn(`Plugin ${pluginId} lacks ui:modal permission`);
          return Promise.resolve(null);
        }

        // Modal implementation will be added in Phase 5 (UI integration)
        console.warn("Modal API not yet implemented");
        return Promise.resolve(null);
      },

      registerToolbarButton(): () => void {
        if (!canToolbar) {
          console.warn(`Plugin ${pluginId} lacks ui:toolbar permission`);
          return () => {};
        }

        // Toolbar integration will be added in Phase 5 (UI integration)
        console.warn("Toolbar button API not yet implemented");
        return () => {};
      },

      registerSidebarPanel(): () => void {
        if (!canPanel) {
          console.warn(`Plugin ${pluginId} lacks ui:panel permission`);
          return () => {};
        }

        // Sidebar integration will be added in Phase 5 (UI integration)
        console.warn("Sidebar panel API not yet implemented");
        return () => {};
      },
    };
  }

  /**
   * Create Event API proxy
   */
  private createEventAPI(pluginId: string): EventAPI {
    const self = this;

    return {
      on(event: string, callback: (...args: unknown[]) => void): () => void {
        // Namespace events to prevent conflicts
        const namespacedEvent = `plugin:${pluginId}:${event}`;
        return self.eventBus.on(namespacedEvent, callback);
      },

      emit(event: string, ...args: unknown[]): void {
        // Plugins can only emit to their own namespace
        const namespacedEvent = `plugin:${pluginId}:${event}`;
        self.eventBus.emit(namespacedEvent, ...args);
      },
    };
  }

  /**
   * Create Metadata API proxy
   */
  private createMetadataAPI(permissions: Set<Permission>): MetadataAPI | null {
    if (!permissions.has("book:metadata") && !permissions.has("chapters:read")) {
      return null;
    }

    // These will integrate with book/chapter stores
    // For now, return placeholder implementation
    return {
      getBookTitle(): string | null {
        // Will integrate with useBookStore
        return null;
      },

      getBookAuthor(): string | null {
        // Will integrate with useBookStore
        return null;
      },

      getChapterTitle(): string | null {
        // Will integrate with useChapterStore
        return null;
      },

      getChapterCount(): number {
        // Will integrate with useChapterStore
        return 0;
      },
    };
  }
}

/**
 * Get the plugin manager singleton
 */
export function getPluginManager(): PluginManager {
  return PluginManager.getInstance();
}
