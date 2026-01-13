import type {
  ManifestValidationResult,
  Permission,
  PluginType,
} from "../types";

/**
 * Valid permission values
 */
const VALID_PERMISSIONS: Permission[] = [
  "editor:read",
  "editor:write",
  "editor:selection",
  "editor:commands",
  "storage:local",
  "storage:book",
  "network:fetch",
  "ui:toolbar",
  "ui:panel",
  "ui:modal",
  "ui:notification",
  "clipboard:read",
  "clipboard:write",
  "settings:read",
  "book:metadata",
  "chapters:read",
  "export:hook",
];

/**
 * Valid plugin types
 */
const VALID_PLUGIN_TYPES: PluginType[] = [
  "editor-extension",
  "toolbar",
  "panel",
  "export",
  "theme",
];

/**
 * Regex for valid plugin ID (reverse domain notation)
 */
const PLUGIN_ID_REGEX = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

/**
 * Regex for semver version
 */
const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;

/**
 * Regex for semver range (simplified)
 */
const SEMVER_RANGE_REGEX =
  /^([<>=~^]*\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\s*\|\|\s*[<>=~^]*\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?)*|\*)$/;

/**
 * Maximum manifest field lengths
 */
const MAX_LENGTHS = {
  id: 128,
  name: 64,
  description: 500,
  authorName: 64,
  authorEmail: 128,
  authorUrl: 256,
  main: 256,
  license: 32,
  homepage: 256,
  repository: 256,
  keyword: 32,
};

/**
 * Maximum number of keywords
 */
const MAX_KEYWORDS = 10;

/**
 * Maximum number of permissions
 */
const MAX_PERMISSIONS = 20;

/**
 * Maximum number of dependencies
 */
const MAX_DEPENDENCIES = 10;

/**
 * Validate a plugin manifest
 */
export function validateManifest(
  manifest: unknown
): ManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check if manifest is an object
  if (!manifest || typeof manifest !== "object") {
    return {
      valid: false,
      errors: ["Manifest must be a JSON object"],
      warnings: [],
    };
  }

  const m = manifest as Record<string, unknown>;

  // Required string fields
  validateRequiredString(m, "id", errors, {
    maxLength: MAX_LENGTHS.id,
    pattern: PLUGIN_ID_REGEX,
    patternMessage:
      "must be in reverse domain notation (e.g., com.author.plugin-name)",
  });

  validateRequiredString(m, "name", errors, {
    maxLength: MAX_LENGTHS.name,
  });

  validateRequiredString(m, "version", errors, {
    pattern: SEMVER_REGEX,
    patternMessage: "must be a valid semver version (e.g., 1.0.0)",
  });

  validateRequiredString(m, "description", errors, {
    maxLength: MAX_LENGTHS.description,
  });

  validateRequiredString(m, "main", errors, {
    maxLength: MAX_LENGTHS.main,
  });

  // Validate main entry point doesn't try path traversal
  if (typeof m.main === "string") {
    if (m.main.includes("..") || m.main.startsWith("/")) {
      errors.push("main: must be a relative path within the plugin directory");
    }
  }

  // Author validation
  if (!m.author || typeof m.author !== "object") {
    errors.push("author: is required and must be an object");
  } else {
    const author = m.author as Record<string, unknown>;
    validateRequiredString(author, "name", errors, {
      maxLength: MAX_LENGTHS.authorName,
      fieldPrefix: "author.",
    });

    if (author.email !== undefined) {
      validateOptionalString(author, "email", errors, warnings, {
        maxLength: MAX_LENGTHS.authorEmail,
        fieldPrefix: "author.",
      });
    }

    if (author.url !== undefined) {
      validateOptionalString(author, "url", errors, warnings, {
        maxLength: MAX_LENGTHS.authorUrl,
        fieldPrefix: "author.",
      });
    }
  }

  // Plugin type validation
  if (!m.type || typeof m.type !== "string") {
    errors.push("type: is required and must be a string");
  } else if (!VALID_PLUGIN_TYPES.includes(m.type as PluginType)) {
    errors.push(
      `type: must be one of: ${VALID_PLUGIN_TYPES.join(", ")}`
    );
  }

  // Permissions validation
  if (!Array.isArray(m.permissions)) {
    errors.push("permissions: is required and must be an array");
  } else {
    if (m.permissions.length > MAX_PERMISSIONS) {
      errors.push(`permissions: cannot exceed ${MAX_PERMISSIONS} items`);
    }

    for (const perm of m.permissions) {
      if (typeof perm !== "string") {
        errors.push("permissions: all items must be strings");
        break;
      }
      if (!VALID_PERMISSIONS.includes(perm as Permission)) {
        errors.push(`permissions: invalid permission "${perm}"`);
      }
    }

    // Check for duplicate permissions
    const uniquePerms = new Set(m.permissions);
    if (uniquePerms.size !== m.permissions.length) {
      warnings.push("permissions: contains duplicate values");
    }
  }

  // Optional permissions validation
  if (m.optionalPermissions !== undefined) {
    if (!Array.isArray(m.optionalPermissions)) {
      errors.push("optionalPermissions: must be an array");
    } else {
      for (const perm of m.optionalPermissions) {
        if (typeof perm !== "string") {
          errors.push("optionalPermissions: all items must be strings");
          break;
        }
        if (!VALID_PERMISSIONS.includes(perm as Permission)) {
          errors.push(`optionalPermissions: invalid permission "${perm}"`);
        }
      }
    }
  }

  // Maibuk version validation
  if (!m.maibukVersion || typeof m.maibukVersion !== "string") {
    errors.push("maibukVersion: is required and must be a string");
  } else if (!SEMVER_RANGE_REGEX.test(m.maibukVersion)) {
    errors.push(
      "maibukVersion: must be a valid semver range (e.g., >=0.1.0, ^1.0.0)"
    );
  }

  // Editor extension validation
  if (m.type === "editor-extension") {
    if (!m.editorExtension || typeof m.editorExtension !== "object") {
      errors.push(
        "editorExtension: is required for editor-extension type plugins"
      );
    } else {
      const ext = m.editorExtension as Record<string, unknown>;

      if (
        !ext.extensionType ||
        !["node", "mark", "extension"].includes(ext.extensionType as string)
      ) {
        errors.push(
          "editorExtension.extensionType: must be 'node', 'mark', or 'extension'"
        );
      }

      if (!ext.name || typeof ext.name !== "string") {
        errors.push("editorExtension.name: is required and must be a string");
      } else if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(ext.name)) {
        errors.push(
          "editorExtension.name: must be a valid identifier (alphanumeric, starting with letter)"
        );
      }

      if (ext.priority !== undefined && typeof ext.priority !== "number") {
        errors.push("editorExtension.priority: must be a number");
      }
    }
  }

  // Dependencies validation
  if (m.dependencies !== undefined) {
    if (typeof m.dependencies !== "object" || Array.isArray(m.dependencies)) {
      errors.push("dependencies: must be an object");
    } else {
      const deps = m.dependencies as Record<string, unknown>;
      const depKeys = Object.keys(deps);

      if (depKeys.length > MAX_DEPENDENCIES) {
        errors.push(`dependencies: cannot exceed ${MAX_DEPENDENCIES} items`);
      }

      for (const [depId, depVersion] of Object.entries(deps)) {
        if (!PLUGIN_ID_REGEX.test(depId)) {
          errors.push(`dependencies: invalid plugin ID "${depId}"`);
        }
        if (typeof depVersion !== "string") {
          errors.push(`dependencies.${depId}: version must be a string`);
        } else if (!SEMVER_RANGE_REGEX.test(depVersion)) {
          errors.push(
            `dependencies.${depId}: version must be a valid semver range`
          );
        }
      }
    }
  }

  // UI configuration validation
  if (m.ui !== undefined) {
    if (typeof m.ui !== "object" || Array.isArray(m.ui)) {
      errors.push("ui: must be an object");
    } else {
      const ui = m.ui as Record<string, unknown>;

      if (ui.settingsPanel !== undefined && typeof ui.settingsPanel !== "boolean") {
        errors.push("ui.settingsPanel: must be a boolean");
      }

      if (ui.toolbarButton !== undefined) {
        if (typeof ui.toolbarButton !== "object") {
          errors.push("ui.toolbarButton: must be an object");
        } else {
          const tb = ui.toolbarButton as Record<string, unknown>;
          if (!tb.icon || typeof tb.icon !== "string") {
            errors.push("ui.toolbarButton.icon: is required");
          }
          if (!tb.tooltip || typeof tb.tooltip !== "string") {
            errors.push("ui.toolbarButton.tooltip: is required");
          }
          if (
            tb.position !== undefined &&
            !["left", "right"].includes(tb.position as string)
          ) {
            errors.push("ui.toolbarButton.position: must be 'left' or 'right'");
          }
        }
      }

      if (ui.sidebarPanel !== undefined) {
        if (typeof ui.sidebarPanel !== "object") {
          errors.push("ui.sidebarPanel: must be an object");
        } else {
          const sp = ui.sidebarPanel as Record<string, unknown>;
          if (!sp.title || typeof sp.title !== "string") {
            errors.push("ui.sidebarPanel.title: is required");
          }
          if (!sp.icon || typeof sp.icon !== "string") {
            errors.push("ui.sidebarPanel.icon: is required");
          }
        }
      }
    }
  }

  // Optional metadata fields
  validateOptionalString(m, "license", errors, warnings, {
    maxLength: MAX_LENGTHS.license,
  });
  validateOptionalString(m, "homepage", errors, warnings, {
    maxLength: MAX_LENGTHS.homepage,
  });
  validateOptionalString(m, "repository", errors, warnings, {
    maxLength: MAX_LENGTHS.repository,
  });

  // Keywords validation
  if (m.keywords !== undefined) {
    if (!Array.isArray(m.keywords)) {
      errors.push("keywords: must be an array");
    } else {
      if (m.keywords.length > MAX_KEYWORDS) {
        warnings.push(`keywords: exceeds recommended limit of ${MAX_KEYWORDS}`);
      }
      for (const keyword of m.keywords) {
        if (typeof keyword !== "string") {
          errors.push("keywords: all items must be strings");
          break;
        }
        if (keyword.length > MAX_LENGTHS.keyword) {
          warnings.push(
            `keywords: "${keyword.slice(0, 20)}..." exceeds max length of ${MAX_LENGTHS.keyword}`
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Helper to validate a required string field
 */
function validateRequiredString(
  obj: Record<string, unknown>,
  field: string,
  errors: string[],
  options: {
    maxLength?: number;
    pattern?: RegExp;
    patternMessage?: string;
    fieldPrefix?: string;
  } = {}
): void {
  const prefix = options.fieldPrefix ?? "";
  const value = obj[field];

  if (value === undefined || value === null) {
    errors.push(`${prefix}${field}: is required`);
    return;
  }

  if (typeof value !== "string") {
    errors.push(`${prefix}${field}: must be a string`);
    return;
  }

  if (value.trim() === "") {
    errors.push(`${prefix}${field}: cannot be empty`);
    return;
  }

  if (options.maxLength && value.length > options.maxLength) {
    errors.push(
      `${prefix}${field}: exceeds maximum length of ${options.maxLength}`
    );
  }

  if (options.pattern && !options.pattern.test(value)) {
    errors.push(
      `${prefix}${field}: ${options.patternMessage ?? "has invalid format"}`
    );
  }
}

/**
 * Helper to validate an optional string field
 */
function validateOptionalString(
  obj: Record<string, unknown>,
  field: string,
  errors: string[],
  warnings: string[],
  options: {
    maxLength?: number;
    pattern?: RegExp;
    patternMessage?: string;
    fieldPrefix?: string;
  } = {}
): void {
  const prefix = options.fieldPrefix ?? "";
  const value = obj[field];

  if (value === undefined || value === null) {
    return;
  }

  if (typeof value !== "string") {
    errors.push(`${prefix}${field}: must be a string`);
    return;
  }

  if (options.maxLength && value.length > options.maxLength) {
    warnings.push(
      `${prefix}${field}: exceeds recommended length of ${options.maxLength}`
    );
  }

  if (options.pattern && !options.pattern.test(value)) {
    errors.push(
      `${prefix}${field}: ${options.patternMessage ?? "has invalid format"}`
    );
  }
}

/**
 * Check if a Maibuk version satisfies a semver range
 * This is a simplified implementation - consider using a proper semver library
 */
export function isCompatibleVersion(
  range: string,
  currentVersion: string
): boolean {
  // Handle wildcard
  if (range === "*") return true;

  // Parse current version
  const currentMatch = currentVersion.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!currentMatch) return false;

  const [, currentMajor, currentMinor, currentPatch] = currentMatch.map(Number);

  // Handle >= operator
  if (range.startsWith(">=")) {
    const targetMatch = range.slice(2).match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!targetMatch) return false;

    const [, major, minor, patch] = targetMatch.map(Number);

    if (currentMajor > major) return true;
    if (currentMajor < major) return false;
    if (currentMinor > minor) return true;
    if (currentMinor < minor) return false;
    return currentPatch >= patch;
  }

  // Handle ^ operator (compatible with version)
  if (range.startsWith("^")) {
    const targetMatch = range.slice(1).match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!targetMatch) return false;

    const [, major, minor, patch] = targetMatch.map(Number);

    // Major version must match (for versions >= 1.0.0)
    if (major > 0) {
      if (currentMajor !== major) return false;
      if (currentMinor > minor) return true;
      if (currentMinor < minor) return false;
      return currentPatch >= patch;
    }

    // For 0.x.x versions, minor must match
    if (currentMajor !== 0) return false;
    if (currentMinor !== minor) return false;
    return currentPatch >= patch;
  }

  // Handle exact version
  const exactMatch = range.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (exactMatch) {
    const [, major, minor, patch] = exactMatch.map(Number);
    return (
      currentMajor === major &&
      currentMinor === minor &&
      currentPatch === patch
    );
  }

  // Unknown format - be permissive
  return true;
}

/**
 * Dangerous patterns to scan for in plugin code
 */
const DANGEROUS_PATTERNS = [
  { pattern: /\beval\s*\(/, reason: "eval() is not allowed" },
  { pattern: /new\s+Function\s*\(/, reason: "new Function() is not allowed" },
  { pattern: /document\.cookie/, reason: "Cookie access is not allowed" },
  { pattern: /\blocalStorage\./, reason: "Direct localStorage access is not allowed (use storage API)" },
  { pattern: /\bsessionStorage\./, reason: "sessionStorage access is not allowed" },
  { pattern: /\bwindow\.open\s*\(/, reason: "window.open() is not allowed" },
  { pattern: /\blocation\s*=/, reason: "Navigation is not allowed" },
  { pattern: /\.innerHTML\s*=/, reason: "innerHTML assignment is not allowed (XSS risk)" },
  { pattern: /\bdocument\.write/, reason: "document.write() is not allowed" },
  { pattern: /\bimportScripts\s*\(/, reason: "importScripts() is not allowed" },
  { pattern: /\b__proto__\b/, reason: "__proto__ access is not allowed" },
  { pattern: /\bconstructor\s*\[/, reason: "constructor access is not allowed" },
];

/**
 * Scan plugin code for dangerous patterns
 */
export function scanCodeForDangerousPatterns(
  code: string
): { safe: boolean; reasons: string[] } {
  const reasons: string[] = [];

  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(code)) {
      reasons.push(reason);
    }
  }

  return {
    safe: reasons.length === 0,
    reasons,
  };
}
