/**
 * Security Module
 *
 * Provides security infrastructure for the plugin system including:
 * - Permission management
 * - Sandboxed execution environment
 * - Content Security Policy
 * - Code validation
 */

// Permission Manager
export {
  PermissionManager,
  PermissionDeniedError,
  getPermissionManager,
  checkPermission,
  requirePermission,
} from "./PermissionManager";

// Plugin Sandbox
export { PluginSandbox, createSandbox } from "./PluginSandbox";

// Security Policy
export {
  generateCSP,
  isUrlAllowed,
  scanForDangerousPatterns,
  validatePluginCode,
  SANDBOX_ATTRIBUTES,
  DANGEROUS_PATTERNS,
  RESTRICTED_GLOBALS,
  generateGlobalRestrictions,
} from "./SecurityPolicy";
