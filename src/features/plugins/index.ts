/**
 * Plugin System
 *
 * This module provides the plugin infrastructure for Maibuk.
 * It allows extending the editor with custom functionality through
 * locally installed plugin packages.
 *
 * @example
 * ```typescript
 * import { usePluginStore, installPluginFromFile, getPluginManager } from '@/features/plugins';
 *
 * // Install a plugin
 * const result = await installPluginFromFile(file);
 * if (result.success) {
 *   console.log('Installed:', result.manifest.name);
 * }
 *
 * // Enable a plugin (after granting permissions)
 * usePluginStore.getState().enablePlugin(pluginId);
 *
 * // Initialize plugin manager (typically in app startup)
 * await getPluginManager().initialize();
 * ```
 */

// =============================================================================
// Types
// =============================================================================

export type {
  // Core plugin types
  Permission,
  PermissionInfo,
  PluginType,
  PluginManifest,
  PluginAuthor,
  InstalledPlugin,
  PluginError,
  PluginInstallResult,
  ManifestValidationResult,

  // Plugin configuration
  EditorExtensionConfig,
  PluginUIConfig,
  ToolbarButtonConfig,
  SidebarPanelConfig,

  // Plugin exports
  PluginExports,

  // Plugin API types
  PluginAPI,
  EditorAPI,
  StorageAPI,
  UIAPI,
  EventAPI,
  MetadataAPI,
  EditorSelection,
  ModalConfig,
  ModalAction,
  NotificationType,
} from "./types";

// Permission info constant
export { PERMISSION_INFO } from "./types";

// =============================================================================
// Store
// =============================================================================

export {
  usePluginStore,
  usePlugins,
  useEditorPlugins,
  usePluginErrors,
  // Storage utilities (for advanced use)
  storePluginCode,
  loadPluginCode,
  removePluginCode,
  clearPluginStorage,
} from "./store";

// =============================================================================
// Core
// =============================================================================

// Plugin Manager
export { PluginManager, getPluginManager } from "./core/PluginManager";

// Plugin Loader
export {
  installPluginFromFile,
  installPluginFromBuffer,
  canInstallPlugin,
  getPluginCode,
} from "./core/PluginLoader";

// Plugin Validator
export {
  validateManifest,
  isCompatibleVersion,
  scanCodeForDangerousPatterns,
} from "./core/PluginValidator";

// =============================================================================
// Security
// =============================================================================

// Permission Manager
export {
  PermissionManager,
  PermissionDeniedError,
  getPermissionManager,
  checkPermission,
  requirePermission,
} from "./security/PermissionManager";

// Plugin Sandbox
export { PluginSandbox, createSandbox } from "./security/PluginSandbox";

// Security Policy
export {
  generateCSP,
  isUrlAllowed,
  validatePluginCode,
  SANDBOX_ATTRIBUTES,
} from "./security/SecurityPolicy";
