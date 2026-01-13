/**
 * Core plugin system components
 */

export { PluginManager, getPluginManager } from "./PluginManager";

export {
  installPluginFromFile,
  installPluginFromBuffer,
  canInstallPlugin,
  getPluginCode,
} from "./PluginLoader";

export {
  validateManifest,
  isCompatibleVersion,
  scanCodeForDangerousPatterns,
} from "./PluginValidator";
