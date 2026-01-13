import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  InstalledPlugin,
  PluginManifest,
  PluginError,
  Permission,
} from "./types";

/**
 * Plugin storage keys for IndexedDB
 */
const PLUGIN_CODE_DB_NAME = "maibuk-plugins";
const PLUGIN_CODE_STORE_NAME = "plugin-code";

/**
 * IndexedDB helpers for storing plugin code (larger than localStorage allows)
 */
async function openPluginDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PLUGIN_CODE_DB_NAME, 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(PLUGIN_CODE_STORE_NAME)) {
        db.createObjectStore(PLUGIN_CODE_STORE_NAME, { keyPath: "id" });
      }
    };
  });
}

/**
 * Store plugin code in IndexedDB
 */
export async function storePluginCode(
  pluginId: string,
  code: string
): Promise<void> {
  const db = await openPluginDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PLUGIN_CODE_STORE_NAME, "readwrite");
    const store = transaction.objectStore(PLUGIN_CODE_STORE_NAME);
    const request = store.put({ id: pluginId, code, updatedAt: Date.now() });

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

/**
 * Load plugin code from IndexedDB
 */
export async function loadPluginCode(
  pluginId: string
): Promise<string | null> {
  const db = await openPluginDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PLUGIN_CODE_STORE_NAME, "readonly");
    const store = transaction.objectStore(PLUGIN_CODE_STORE_NAME);
    const request = store.get(pluginId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result?.code ?? null);
  });
}

/**
 * Remove plugin code from IndexedDB
 */
export async function removePluginCode(pluginId: string): Promise<void> {
  const db = await openPluginDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PLUGIN_CODE_STORE_NAME, "readwrite");
    const store = transaction.objectStore(PLUGIN_CODE_STORE_NAME);
    const request = store.delete(pluginId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

/**
 * Clear plugin-scoped localStorage
 */
export function clearPluginStorage(pluginId: string): void {
  const prefix = `maibuk-plugin:${pluginId}:`;
  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach((key) => localStorage.removeItem(key));
}

/**
 * Plugin store state
 */
interface PluginState {
  /** Map of installed plugins by ID */
  plugins: Record<string, InstalledPlugin>;

  /** IDs of currently loaded TipTap extensions */
  loadedExtensions: string[];

  /** Recent plugin errors */
  errors: PluginError[];

  /** Whether plugins have been initialized on app start */
  initialized: boolean;
}

/**
 * Plugin store actions
 */
interface PluginActions {
  /** Install a new plugin */
  installPlugin: (manifest: PluginManifest, code: string) => Promise<void>;

  /** Uninstall a plugin completely */
  uninstallPlugin: (id: string) => Promise<void>;

  /** Enable a plugin (requires all permissions granted) */
  enablePlugin: (id: string) => void;

  /** Disable a plugin */
  disablePlugin: (id: string) => void;

  /** Grant a permission to a plugin */
  grantPermission: (id: string, permission: Permission) => void;

  /** Revoke a permission from a plugin */
  revokePermission: (id: string, permission: Permission) => void;

  /** Grant all required permissions at once */
  grantAllRequiredPermissions: (id: string) => void;

  /** Update plugin-specific settings */
  updatePluginSettings: (
    id: string,
    settings: Record<string, unknown>
  ) => void;

  /** Update storage usage for a plugin */
  updateStorageUsage: (id: string, bytes: number) => void;

  /** Mark an extension as loaded */
  markExtensionLoaded: (pluginId: string) => void;

  /** Mark an extension as unloaded */
  markExtensionUnloaded: (pluginId: string) => void;

  /** Report a plugin error */
  reportError: (error: Omit<PluginError, "timestamp">) => void;

  /** Clear errors for a specific plugin or all plugins */
  clearErrors: (pluginId?: string) => void;

  /** Mark plugins as initialized */
  setInitialized: (initialized: boolean) => void;

  /** Get a plugin by ID */
  getPlugin: (id: string) => InstalledPlugin | undefined;

  /** Get all enabled plugins */
  getEnabledPlugins: () => InstalledPlugin[];

  /** Get all enabled plugins of a specific type */
  getEnabledPluginsByType: (type: string) => InstalledPlugin[];

  /** Check if a plugin has a specific permission */
  hasPermission: (id: string, permission: Permission) => boolean;
}

type PluginStore = PluginState & PluginActions;

/**
 * Maximum number of errors to keep per plugin
 */
const MAX_ERRORS_PER_PLUGIN = 10;

/**
 * Number of errors that triggers auto-disable
 */
const AUTO_DISABLE_ERROR_THRESHOLD = 3;

/**
 * Time window for error threshold (5 minutes)
 */
const ERROR_THRESHOLD_WINDOW_MS = 5 * 60 * 1000;

export const usePluginStore = create<PluginStore>()(
  persist(
    (set, get) => ({
      // Initial state
      plugins: {},
      loadedExtensions: [],
      errors: [],
      initialized: false,

      // Actions
      installPlugin: async (manifest, code) => {
        // Store code in IndexedDB
        await storePluginCode(manifest.id, code);

        set((state) => ({
          plugins: {
            ...state.plugins,
            [manifest.id]: {
              id: manifest.id,
              manifest,
              enabled: false, // Disabled by default until permissions granted
              installedAt: Date.now(),
              updatedAt: Date.now(),
              grantedPermissions: [],
              settings: {},
              storageUsage: 0,
            },
          },
        }));
      },

      uninstallPlugin: async (id) => {
        // Remove code from IndexedDB
        await removePluginCode(id);

        // Clear plugin storage
        clearPluginStorage(id);

        set((state) => {
          const { [id]: _removed, ...remaining } = state.plugins;
          return {
            plugins: remaining,
            loadedExtensions: state.loadedExtensions.filter((e) => e !== id),
            errors: state.errors.filter((e) => e.pluginId !== id),
          };
        });
      },

      enablePlugin: (id) => {
        const plugin = get().plugins[id];
        if (!plugin) return;

        // Check if all required permissions are granted
        const missingPermissions = plugin.manifest.permissions.filter(
          (p) => !plugin.grantedPermissions.includes(p)
        );

        if (missingPermissions.length > 0) {
          console.warn(
            `Cannot enable plugin ${id}: missing permissions`,
            missingPermissions
          );
          return;
        }

        set((state) => ({
          plugins: {
            ...state.plugins,
            [id]: { ...state.plugins[id], enabled: true, updatedAt: Date.now() },
          },
        }));
      },

      disablePlugin: (id) => {
        set((state) => ({
          plugins: {
            ...state.plugins,
            [id]: { ...state.plugins[id], enabled: false, updatedAt: Date.now() },
          },
          loadedExtensions: state.loadedExtensions.filter((e) => e !== id),
        }));
      },

      grantPermission: (id, permission) => {
        set((state) => {
          const plugin = state.plugins[id];
          if (!plugin) return state;

          // Don't add duplicate permissions
          if (plugin.grantedPermissions.includes(permission)) return state;

          return {
            plugins: {
              ...state.plugins,
              [id]: {
                ...plugin,
                grantedPermissions: [...plugin.grantedPermissions, permission],
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      revokePermission: (id, permission) => {
        set((state) => {
          const plugin = state.plugins[id];
          if (!plugin) return state;

          const newPermissions = plugin.grantedPermissions.filter(
            (p) => p !== permission
          );

          // If revoking a required permission, disable the plugin
          const isRequired = plugin.manifest.permissions.includes(permission);

          return {
            plugins: {
              ...state.plugins,
              [id]: {
                ...plugin,
                grantedPermissions: newPermissions,
                enabled: isRequired ? false : plugin.enabled,
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      grantAllRequiredPermissions: (id) => {
        set((state) => {
          const plugin = state.plugins[id];
          if (!plugin) return state;

          const allPermissions = new Set([
            ...plugin.grantedPermissions,
            ...plugin.manifest.permissions,
          ]);

          return {
            plugins: {
              ...state.plugins,
              [id]: {
                ...plugin,
                grantedPermissions: Array.from(allPermissions),
                updatedAt: Date.now(),
              },
            },
          };
        });
      },

      updatePluginSettings: (id, settings) => {
        set((state) => ({
          plugins: {
            ...state.plugins,
            [id]: {
              ...state.plugins[id],
              settings: { ...state.plugins[id].settings, ...settings },
              updatedAt: Date.now(),
            },
          },
        }));
      },

      updateStorageUsage: (id, bytes) => {
        set((state) => ({
          plugins: {
            ...state.plugins,
            [id]: { ...state.plugins[id], storageUsage: bytes },
          },
        }));
      },

      markExtensionLoaded: (pluginId) => {
        set((state) => ({
          loadedExtensions: state.loadedExtensions.includes(pluginId)
            ? state.loadedExtensions
            : [...state.loadedExtensions, pluginId],
        }));
      },

      markExtensionUnloaded: (pluginId) => {
        set((state) => ({
          loadedExtensions: state.loadedExtensions.filter((e) => e !== pluginId),
        }));
      },

      reportError: (error) => {
        const now = Date.now();

        set((state) => {
          // Add new error
          const newError: PluginError = { ...error, timestamp: now };
          let errors = [...state.errors, newError];

          // Keep only recent errors per plugin (max MAX_ERRORS_PER_PLUGIN)
          const pluginErrors = errors.filter((e) => e.pluginId === error.pluginId);
          if (pluginErrors.length > MAX_ERRORS_PER_PLUGIN) {
            const oldestToKeep =
              pluginErrors[pluginErrors.length - MAX_ERRORS_PER_PLUGIN];
            errors = errors.filter(
              (e) =>
                e.pluginId !== error.pluginId || e.timestamp >= oldestToKeep.timestamp
            );
          }

          // Check if we should auto-disable due to too many recent errors
          const recentErrors = pluginErrors.filter(
            (e) => now - e.timestamp < ERROR_THRESHOLD_WINDOW_MS
          );

          let plugins = state.plugins;
          if (recentErrors.length >= AUTO_DISABLE_ERROR_THRESHOLD) {
            const plugin = state.plugins[error.pluginId];
            if (plugin?.enabled) {
              console.warn(
                `Auto-disabling plugin ${error.pluginId} due to repeated errors`
              );
              plugins = {
                ...state.plugins,
                [error.pluginId]: { ...plugin, enabled: false },
              };
            }
          }

          return { errors, plugins };
        });
      },

      clearErrors: (pluginId) => {
        set((state) => ({
          errors: pluginId
            ? state.errors.filter((e) => e.pluginId !== pluginId)
            : [],
        }));
      },

      setInitialized: (initialized) => {
        set({ initialized });
      },

      getPlugin: (id) => {
        return get().plugins[id];
      },

      getEnabledPlugins: () => {
        return Object.values(get().plugins).filter((p) => p.enabled);
      },

      getEnabledPluginsByType: (type) => {
        return Object.values(get().plugins).filter(
          (p) => p.enabled && p.manifest.type === type
        );
      },

      hasPermission: (id, permission) => {
        const plugin = get().plugins[id];
        return plugin?.grantedPermissions.includes(permission) ?? false;
      },
    }),
    {
      name: "maibuk-plugins",
      // Only persist plugins metadata, not runtime state
      partialize: (state) => ({
        plugins: state.plugins,
        // Don't persist: loadedExtensions, errors, initialized
      }),
    }
  )
);

/**
 * Hook for accessing plugin store with common selectors
 */
export function usePlugins() {
  return usePluginStore();
}

/**
 * Hook for getting enabled editor extension plugins
 */
export function useEditorPlugins() {
  return usePluginStore((state) =>
    Object.values(state.plugins).filter(
      (p) => p.enabled && p.manifest.type === "editor-extension"
    )
  );
}

/**
 * Hook for getting plugin errors
 */
export function usePluginErrors(pluginId?: string) {
  return usePluginStore((state) =>
    pluginId
      ? state.errors.filter((e) => e.pluginId === pluginId)
      : state.errors
  );
}
