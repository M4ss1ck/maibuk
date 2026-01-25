/**
 * usePluginExtensions Hook
 *
 * React hook that provides TipTap extensions from enabled plugins.
 * Handles dynamic loading, error boundaries, and cleanup.
 */

import { useState, useEffect } from "react";
import { Extension } from "@tiptap/core";
import { usePluginStore } from "../store";
import { getPluginManager } from "../core/PluginManager";

/**
 * Plugin extension with metadata
 */
export interface PluginExtensionInfo {
  pluginId: string;
  pluginName: string;
  extension: Extension;
  priority: number;
}

/**
 * Hook options
 */
export interface UsePluginExtensionsOptions {
  /**
   * Whether to enable plugin extensions
   * @default true
   */
  enabled?: boolean;
}

/**
 * Hook that returns TipTap extensions from enabled plugins
 *
 * Note: Due to TipTap's architecture, extensions must be provided
 * at editor initialization. This means the editor needs to be
 * re-created when plugins change. Use the `key` return value
 * to trigger editor re-initialization.
 *
 * @example
 * ```tsx
 * const { extensions, key, loading, errors } = usePluginExtensions();
 *
 * const editor = useEditor({
 *   extensions: [
 *     StarterKit,
 *     ...extensions,
 *   ],
 * }, [key]); // Re-create editor when key changes
 * ```
 */
export function usePluginExtensions(options: UsePluginExtensionsOptions = {}) {
  const { enabled = true } = options;

  const [loading, setLoading] = useState(true);
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [extensionInfo, setExtensionInfo] = useState<PluginExtensionInfo[]>([]);
  const [errors, setErrors] = useState<Array<{ pluginId: string; error: string }>>([]);

  // Create a stable key directly from store state (returns a string, not an array)
  // This prevents infinite loops from array reference changes
  const pluginsKey = usePluginStore((state) => {
    if (!enabled) return "disabled";
    return Object.values(state.plugins)
      .filter((p) => p.enabled && p.manifest.type === "editor-extension")
      .map((p) => `${p.id}:${p.manifest.version}`)
      .sort()
      .join(",");
  });

  // Load extensions when plugins change
  // Note: We use pluginsKey as the dependency instead of enabledPlugins
  // because enabledPlugins creates a new array reference on each render
  useEffect(() => {
    if (!enabled) {
      setExtensions([]);
      setExtensionInfo([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadExtensions() {
      setLoading(true);
      setErrors([]);

      const manager = getPluginManager();
      const loadedExtensions: PluginExtensionInfo[] = [];
      const loadErrors: Array<{ pluginId: string; error: string }> = [];

      // Get current plugins from store to avoid stale closure
      const currentPlugins = usePluginStore.getState();
      const plugins = Object.values(currentPlugins.plugins).filter(
        (p) => p.enabled && p.manifest.type === "editor-extension"
      );

      for (const plugin of plugins) {
        try {
          // Get extension from plugin manager
          const ext = manager.getPluginExtension(plugin.id);

          if (ext && isValidExtension(ext)) {
            loadedExtensions.push({
              pluginId: plugin.id,
              pluginName: plugin.manifest.name,
              extension: ext as Extension,
              priority: plugin.manifest.editorExtension?.priority ?? 100,
            });
          }
        } catch (error) {
          console.error(`Failed to load extension from plugin ${plugin.id}:`, error);
          loadErrors.push({
            pluginId: plugin.id,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      if (cancelled) return;

      // Sort by priority (lower = earlier)
      loadedExtensions.sort((a, b) => a.priority - b.priority);

      setExtensionInfo(loadedExtensions);
      setExtensions(loadedExtensions.map((e) => wrapWithErrorBoundary(e)));
      setErrors(loadErrors);
      setLoading(false);
    }

    loadExtensions();

    return () => {
      cancelled = true;
    };
  }, [enabled, pluginsKey]);

  return {
    /**
     * Array of TipTap extensions to add to the editor
     */
    extensions,

    /**
     * Detailed info about loaded extensions
     */
    extensionInfo,

    /**
     * Key that changes when plugins change - use for editor re-initialization
     */
    key: pluginsKey,

    /**
     * Whether extensions are currently being loaded
     */
    loading,

    /**
     * Errors that occurred while loading extensions
     */
    errors,

    /**
     * Number of enabled plugin extensions
     */
    count: extensions.length,
  };
}

/**
 * Check if an object is a valid TipTap extension
 */
function isValidExtension(ext: unknown): ext is Extension {
  if (!ext || typeof ext !== "object") return false;

  const e = ext as Record<string, unknown>;

  // Check for TipTap extension properties
  return (
    typeof e.name === "string" &&
    typeof e.type === "string" &&
    (e.type === "extension" || e.type === "node" || e.type === "mark")
  );
}

/**
 * Wrap an extension with error boundary behavior
 */
function wrapWithErrorBoundary(info: PluginExtensionInfo): Extension {
  const { extension, pluginId, pluginName } = info;

  // Create a wrapper extension that catches errors
  return Extension.create({
    name: `plugin_${pluginId}_${extension.name}`,
    priority: info.priority,

    // Forward extension configuration
    addOptions() {
      try {
        const original = extension.options;
        return typeof original === "function"
          ? (original as () => Record<string, unknown>).call(this)
          : original ?? {};
      } catch (error) {
        console.error(`Plugin "${pluginName}" error in addOptions:`, error);
        return {};
      }
    },

    addCommands() {
      try {
        const config = extension.config as unknown as Record<string, unknown>;
        const addCommands = config.addCommands as (() => Record<string, unknown>) | undefined;
        return addCommands?.call(this) ?? {};
      } catch (error) {
        console.error(`Plugin "${pluginName}" error in addCommands:`, error);
        return {};
      }
    },

    addKeyboardShortcuts() {
      try {
        const config = extension.config as unknown as Record<string, unknown>;
        const fn = config.addKeyboardShortcuts as (() => Record<string, unknown>) | undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (fn?.call(this) ?? {}) as any;
      } catch (error) {
        console.error(`Plugin "${pluginName}" error in addKeyboardShortcuts:`, error);
        return {};
      }
    },

    addInputRules() {
      try {
        const config = extension.config as unknown as Record<string, unknown>;
        const fn = config.addInputRules as (() => unknown[]) | undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (fn?.call(this) ?? []) as any;
      } catch (error) {
        console.error(`Plugin "${pluginName}" error in addInputRules:`, error);
        return [];
      }
    },

    addPasteRules() {
      try {
        const config = extension.config as unknown as Record<string, unknown>;
        const fn = config.addPasteRules as (() => unknown[]) | undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (fn?.call(this) ?? []) as any;
      } catch (error) {
        console.error(`Plugin "${pluginName}" error in addPasteRules:`, error);
        return [];
      }
    },

    addProseMirrorPlugins() {
      try {
        const config = extension.config as unknown as Record<string, unknown>;
        const fn = config.addProseMirrorPlugins as (() => unknown[]) | undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (fn?.call(this) ?? []) as any;
      } catch (error) {
        console.error(`Plugin "${pluginName}" error in addProseMirrorPlugins:`, error);
        return [];
      }
    },

    onBeforeCreate() {
      try {
        const config = extension.config as unknown as Record<string, unknown>;
        const onBeforeCreate = config.onBeforeCreate as (() => void) | undefined;
        onBeforeCreate?.call(this);
      } catch (error) {
        console.error(`Plugin "${pluginName}" error in onBeforeCreate:`, error);
      }
    },

    onCreate() {
      try {
        const config = extension.config as unknown as Record<string, unknown>;
        const onCreate = config.onCreate as (() => void) | undefined;
        onCreate?.call(this);
      } catch (error) {
        console.error(`Plugin "${pluginName}" error in onCreate:`, error);
      }
    },

    onUpdate() {
      try {
        const config = extension.config as unknown as Record<string, unknown>;
        const onUpdate = config.onUpdate as (() => void) | undefined;
        onUpdate?.call(this);
      } catch (error) {
        console.error(`Plugin "${pluginName}" error in onUpdate:`, error);
      }
    },

    onDestroy() {
      try {
        const config = extension.config as unknown as Record<string, unknown>;
        const onDestroy = config.onDestroy as (() => void) | undefined;
        onDestroy?.call(this);
      } catch (error) {
        console.error(`Plugin "${pluginName}" error in onDestroy:`, error);
      }
    },
  });
}

/**
 * Hook to check if plugins are available
 */
export function usePluginsAvailable(): boolean {
  return usePluginStore((state) =>
    Object.values(state.plugins).some(
      (p) => p.enabled && p.manifest.type === "editor-extension"
    )
  );
}
