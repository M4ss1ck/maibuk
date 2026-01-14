/**
 * Storage API
 *
 * Provides a secure, quota-limited storage interface for plugins.
 * Each plugin gets isolated storage with a 5MB quota.
 */

import type { StorageAPI } from "../types";
import { usePluginStore } from "../store";
import { getPermissionManager } from "../security/PermissionManager";

/**
 * Storage quota per plugin (5MB)
 */
const STORAGE_QUOTA = 5 * 1024 * 1024;

/**
 * Plugin storage prefix in localStorage
 */
const STORAGE_PREFIX = "maibuk-plugin:";

/**
 * Storage API factory options
 */
export interface StorageAPIOptions {
  pluginId: string;
}

/**
 * Create a Storage API instance for a plugin
 */
export function createStorageAPI(options: StorageAPIOptions): StorageAPI | null {
  const { pluginId } = options;
  const permissionManager = getPermissionManager();

  // Check storage permission
  if (!permissionManager.hasPermission(pluginId, "storage:local")) {
    return null;
  }

  const prefix = `${STORAGE_PREFIX}${pluginId}:`;

  /**
   * Calculate current storage usage for this plugin
   */
  const calculateUsage = (): number => {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        const value = localStorage.getItem(key);
        if (value) {
          // Calculate size in bytes
          total += new Blob([key, value]).size;
        }
      }
    }
    return total;
  };

  /**
   * Update storage usage in the store
   */
  const updateUsageInStore = (bytes: number): void => {
    usePluginStore.getState().updateStorageUsage(pluginId, bytes);
  };

  /**
   * Validate a storage key
   */
  const validateKey = (key: string): void => {
    if (!key || typeof key !== "string") {
      throw new Error("Storage key must be a non-empty string");
    }
    if (key.length > 256) {
      throw new Error("Storage key exceeds maximum length of 256 characters");
    }
    if (key.includes("..") || key.includes("/") || key.includes("\\")) {
      throw new Error("Storage key contains invalid characters");
    }
  };

  return {
    async get<T>(key: string): Promise<T | null> {
      validateKey(key);

      const fullKey = prefix + key;
      const value = localStorage.getItem(fullKey);

      if (value === null) {
        return null;
      }

      try {
        return JSON.parse(value) as T;
      } catch {
        // If parsing fails, return as string (cast)
        console.warn(`Plugin "${pluginId}": Failed to parse stored value for key "${key}"`);
        return value as unknown as T;
      }
    },

    async set<T>(key: string, value: T): Promise<void> {
      validateKey(key);

      const fullKey = prefix + key;
      let serialized: string;

      try {
        serialized = JSON.stringify(value);
      } catch (error) {
        throw new Error(
          `Failed to serialize value: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }

      // Check size limits
      const newSize = new Blob([fullKey, serialized]).size;
      const currentUsage = calculateUsage();

      // Subtract existing key size if overwriting
      const existingValue = localStorage.getItem(fullKey);
      const existingSize = existingValue
        ? new Blob([fullKey, existingValue]).size
        : 0;

      const projectedUsage = currentUsage - existingSize + newSize;

      if (projectedUsage > STORAGE_QUOTA) {
        const usedKB = Math.round(currentUsage / 1024);
        const quotaKB = Math.round(STORAGE_QUOTA / 1024);
        throw new Error(
          `Storage quota exceeded. Used: ${usedKB}KB / ${quotaKB}KB`
        );
      }

      // Store the value
      try {
        localStorage.setItem(fullKey, serialized);
      } catch (error) {
        // Handle QuotaExceededError from browser
        if (error instanceof Error && error.name === "QuotaExceededError") {
          throw new Error("Browser storage quota exceeded");
        }
        throw error;
      }

      // Update usage tracking
      updateUsageInStore(projectedUsage);
    },

    async remove(key: string): Promise<void> {
      validateKey(key);

      const fullKey = prefix + key;
      localStorage.removeItem(fullKey);

      // Update usage tracking
      updateUsageInStore(calculateUsage());
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

      // Update usage tracking
      updateUsageInStore(0);
    },

    async keys(): Promise<string[]> {
      const result: string[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) {
          // Return without prefix
          result.push(key.slice(prefix.length));
        }
      }

      return result.sort();
    },

    getUsage(): number {
      return calculateUsage();
    },

    getQuota(): number {
      return STORAGE_QUOTA;
    },
  };
}

/**
 * Get storage quota constant
 */
export function getStorageQuota(): number {
  return STORAGE_QUOTA;
}

/**
 * Get storage prefix for a plugin
 */
export function getStoragePrefix(pluginId: string): string {
  return `${STORAGE_PREFIX}${pluginId}:`;
}

/**
 * Clear all storage for a plugin (used during uninstall)
 */
export function clearPluginStorageData(pluginId: string): void {
  const prefix = `${STORAGE_PREFIX}${pluginId}:`;
  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach((key) => localStorage.removeItem(key));
}
