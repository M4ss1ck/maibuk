/**
 * Plugin Loader
 *
 * Handles loading plugins from ZIP files, validating them,
 * and installing them into the plugin store.
 *
 * NOTE: Requires 'jszip' package. Install with: pnpm add jszip
 */

import JSZip from "jszip";
import type { PluginManifest, PluginInstallResult } from "../types";
import {
  validateManifest,
  isCompatibleVersion,
  scanCodeForDangerousPatterns,
} from "./PluginValidator";
import { usePluginStore, storePluginCode } from "../store";

/**
 * Current Maibuk version for compatibility checking
 * This should be imported from a central version file in production
 */
const MAIBUK_VERSION = "0.1.18";

/**
 * Maximum plugin ZIP file size (10MB)
 */
const MAX_ZIP_SIZE = 10 * 1024 * 1024;

/**
 * Maximum individual file size within the ZIP (5MB)
 */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

/**
 * Allowed file extensions in plugin ZIPs
 */
const ALLOWED_EXTENSIONS = [
  ".js",
  ".json",
  ".css",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".txt",
  ".md",
];

/**
 * Install a plugin from a File object (typically from file input)
 */
export async function installPluginFromFile(
  file: File
): Promise<PluginInstallResult> {
  // Check file size
  if (file.size > MAX_ZIP_SIZE) {
    return {
      success: false,
      error: `Plugin file exceeds maximum size of ${MAX_ZIP_SIZE / 1024 / 1024}MB`,
    };
  }

  // Check file extension
  if (!file.name.endsWith(".zip")) {
    return {
      success: false,
      error: "Plugin must be a .zip file",
    };
  }

  try {
    // Load ZIP contents
    const zip = new JSZip();
    const contents = await zip.loadAsync(file);

    return await installPluginFromZip(contents);
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? `Failed to read ZIP file: ${error.message}`
          : "Failed to read ZIP file",
    };
  }
}

/**
 * Install a plugin from an ArrayBuffer (for programmatic installation)
 */
export async function installPluginFromBuffer(
  buffer: ArrayBuffer
): Promise<PluginInstallResult> {
  if (buffer.byteLength > MAX_ZIP_SIZE) {
    return {
      success: false,
      error: `Plugin data exceeds maximum size of ${MAX_ZIP_SIZE / 1024 / 1024}MB`,
    };
  }

  try {
    const zip = new JSZip();
    const contents = await zip.loadAsync(buffer);

    return await installPluginFromZip(contents);
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? `Failed to read plugin data: ${error.message}`
          : "Failed to read plugin data",
    };
  }
}

/**
 * Core installation logic from an already-loaded JSZip instance
 */
async function installPluginFromZip(
  zip: JSZip
): Promise<PluginInstallResult> {
  // 1. Find and parse manifest
  const manifestFile = zip.file("plugin.json");
  if (!manifestFile) {
    return {
      success: false,
      error: "Missing plugin.json manifest file in ZIP root",
    };
  }

  let manifest: PluginManifest;
  try {
    const manifestText = await manifestFile.async("string");
    manifest = JSON.parse(manifestText) as PluginManifest;
  } catch (error) {
    return {
      success: false,
      error: "Failed to parse plugin.json: Invalid JSON",
    };
  }

  // 2. Validate manifest
  const validation = validateManifest(manifest);
  if (!validation.valid) {
    return {
      success: false,
      error: `Invalid manifest: ${validation.errors.join("; ")}`,
    };
  }

  // Log warnings but don't fail
  if (validation.warnings.length > 0) {
    console.warn(
      `Plugin ${manifest.id} manifest warnings:`,
      validation.warnings
    );
  }

  // 3. Check Maibuk version compatibility
  if (!isCompatibleVersion(manifest.maibukVersion, MAIBUK_VERSION)) {
    return {
      success: false,
      error: `Plugin requires Maibuk ${manifest.maibukVersion}, but current version is ${MAIBUK_VERSION}`,
    };
  }

  // 4. Check if plugin is already installed
  const existingPlugin = usePluginStore.getState().plugins[manifest.id];
  if (existingPlugin) {
    // For now, reject. In the future, support updates.
    return {
      success: false,
      error: `Plugin "${manifest.name}" is already installed. Uninstall it first to reinstall.`,
    };
  }

  // 5. Find and load main entry point
  const mainFile = zip.file(manifest.main);
  if (!mainFile) {
    return {
      success: false,
      error: `Entry point not found: ${manifest.main}`,
    };
  }

  let code: string;
  try {
    code = await mainFile.async("string");
  } catch (error) {
    return {
      success: false,
      error: "Failed to read plugin entry point",
    };
  }

  // Check main file size after reading
  if (new Blob([code]).size > MAX_FILE_SIZE) {
    return {
      success: false,
      error: `Entry point file exceeds maximum size of ${MAX_FILE_SIZE / 1024}KB`,
    };
  }

  // 6. Security scan
  const securityScan = scanCodeForDangerousPatterns(code);
  if (!securityScan.safe) {
    return {
      success: false,
      error: `Security scan failed: ${securityScan.reasons.join("; ")}`,
    };
  }

  // 7. Validate all files in ZIP
  const fileValidation = await validateZipContents(zip);
  if (!fileValidation.valid) {
    return {
      success: false,
      error: fileValidation.error,
    };
  }

  // 8. Store plugin code and metadata
  try {
    await storePluginCode(manifest.id, code);
    await usePluginStore.getState().installPlugin(manifest, code);
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? `Failed to store plugin: ${error.message}`
          : "Failed to store plugin",
    };
  }

  return {
    success: true,
    manifest,
  };
}

/**
 * Validate all files in the ZIP
 */
async function validateZipContents(
  zip: JSZip
): Promise<{ valid: boolean; error?: string }> {
  const files = Object.keys(zip.files);

  for (const filePath of files) {
    const file = zip.files[filePath];

    // Skip directories
    if (file.dir) continue;

    // Check for path traversal attempts
    if (filePath.includes("..") || filePath.startsWith("/")) {
      return {
        valid: false,
        error: `Invalid file path: ${filePath}`,
      };
    }

    // Check file extension
    const ext = getFileExtension(filePath);
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return {
        valid: false,
        error: `File type not allowed: ${ext} (${filePath})`,
      };
    }

    // Note: Individual file sizes are checked when reading content
    // The overall ZIP size limit provides initial protection
  }

  return { valid: true };
}

/**
 * Get lowercase file extension including the dot
 */
function getFileExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filePath.slice(lastDot).toLowerCase();
}

/**
 * Load plugin code from storage by ID
 */
export async function getPluginCode(pluginId: string): Promise<string | null> {
  const { loadPluginCode } = await import("../store");
  return loadPluginCode(pluginId);
}

/**
 * Check if a plugin can be installed (pre-flight check)
 */
export async function canInstallPlugin(
  file: File
): Promise<{ canInstall: boolean; manifest?: PluginManifest; error?: string }> {
  if (file.size > MAX_ZIP_SIZE) {
    return {
      canInstall: false,
      error: `Plugin file exceeds maximum size of ${MAX_ZIP_SIZE / 1024 / 1024}MB`,
    };
  }

  if (!file.name.endsWith(".zip")) {
    return {
      canInstall: false,
      error: "Plugin must be a .zip file",
    };
  }

  try {
    const zip = new JSZip();
    const contents = await zip.loadAsync(file);

    const manifestFile = contents.file("plugin.json");
    if (!manifestFile) {
      return {
        canInstall: false,
        error: "Missing plugin.json manifest file",
      };
    }

    const manifestText = await manifestFile.async("string");
    const manifest = JSON.parse(manifestText) as PluginManifest;

    const validation = validateManifest(manifest);
    if (!validation.valid) {
      return {
        canInstall: false,
        error: validation.errors[0],
      };
    }

    if (!isCompatibleVersion(manifest.maibukVersion, MAIBUK_VERSION)) {
      return {
        canInstall: false,
        error: `Requires Maibuk ${manifest.maibukVersion}`,
      };
    }

    const existingPlugin = usePluginStore.getState().plugins[manifest.id];
    if (existingPlugin) {
      return {
        canInstall: false,
        manifest,
        error: `Plugin "${manifest.name}" is already installed`,
      };
    }

    return {
      canInstall: true,
      manifest,
    };
  } catch (error) {
    return {
      canInstall: false,
      error: error instanceof Error ? error.message : "Failed to read plugin file",
    };
  }
}
