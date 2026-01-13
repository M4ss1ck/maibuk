/**
 * Security Policy
 *
 * Defines Content Security Policy (CSP) rules and other security
 * constraints for plugin sandboxes.
 */

import type { Permission } from "../types";

/**
 * Base CSP directives that apply to all plugins
 */
const BASE_CSP_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'none'"],
  "script-src": ["'unsafe-inline'", "'unsafe-eval'"], // Required for plugin code execution
  "style-src": ["'unsafe-inline'"],
  "img-src": ["data:", "blob:"],
  "font-src": ["data:"],
  "worker-src": ["'none'"],
  "child-src": ["'none'"],
  "frame-src": ["'none'"],
  "object-src": ["'none'"],
  "base-uri": ["'none'"],
  "form-action": ["'none'"],
};

/**
 * CSP directive additions based on permissions
 */
const PERMISSION_CSP_ADDITIONS: Partial<
  Record<Permission, Record<string, string[]>>
> = {
  "network:fetch": {
    "connect-src": ["https:", "wss:"],
  },
};

/**
 * Domains that are always blocked, even with network permission
 */
const BLOCKED_DOMAINS = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  // Block local network ranges
  "10.*",
  "172.16.*",
  "172.17.*",
  "172.18.*",
  "172.19.*",
  "172.20.*",
  "172.21.*",
  "172.22.*",
  "172.23.*",
  "172.24.*",
  "172.25.*",
  "172.26.*",
  "172.27.*",
  "172.28.*",
  "172.29.*",
  "172.30.*",
  "172.31.*",
  "192.168.*",
];

/**
 * Sandbox attributes for plugin iframes
 */
export const SANDBOX_ATTRIBUTES = [
  "allow-scripts", // Required for plugin code execution
  // Intentionally NOT included:
  // - allow-same-origin (prevents access to parent)
  // - allow-forms (no form submission)
  // - allow-popups (no popups)
  // - allow-top-navigation (no navigation)
  // - allow-modals (no alert/confirm/prompt)
].join(" ");

/**
 * Generate CSP string for a plugin based on its permissions
 */
export function generateCSP(permissions: Permission[]): string {
  const directives = { ...BASE_CSP_DIRECTIVES };

  // Add permission-specific directives
  for (const permission of permissions) {
    const additions = PERMISSION_CSP_ADDITIONS[permission];
    if (additions) {
      for (const [directive, values] of Object.entries(additions)) {
        if (directives[directive]) {
          // Merge with existing, avoiding duplicates
          const existing = new Set(directives[directive]);
          values.forEach((v) => existing.add(v));
          directives[directive] = Array.from(existing);
        } else {
          directives[directive] = [...values];
        }
      }
    }
  }

  // Convert to CSP string
  return Object.entries(directives)
    .map(([directive, values]) => `${directive} ${values.join(" ")}`)
    .join("; ");
}

/**
 * Check if a URL is allowed based on permissions
 */
export function isUrlAllowed(
  url: string,
  permissions: Permission[]
): { allowed: boolean; reason?: string } {
  // Must have network permission
  if (!permissions.includes("network:fetch")) {
    return { allowed: false, reason: "network:fetch permission required" };
  }

  try {
    const parsed = new URL(url);

    // Only HTTPS allowed (except for data URLs)
    if (parsed.protocol !== "https:" && parsed.protocol !== "data:") {
      return {
        allowed: false,
        reason: `Protocol "${parsed.protocol}" not allowed, only HTTPS`,
      };
    }

    // Check blocked domains
    const hostname = parsed.hostname.toLowerCase();
    for (const blocked of BLOCKED_DOMAINS) {
      if (blocked.includes("*")) {
        // Wildcard pattern
        const pattern = blocked.replace(/\*/g, ".*");
        if (new RegExp(`^${pattern}$`).test(hostname)) {
          return { allowed: false, reason: `Domain "${hostname}" is blocked` };
        }
      } else if (hostname === blocked) {
        return { allowed: false, reason: `Domain "${hostname}" is blocked` };
      }
    }

    return { allowed: true };
  } catch {
    return { allowed: false, reason: "Invalid URL" };
  }
}

/**
 * Dangerous code patterns that should be blocked
 */
export const DANGEROUS_PATTERNS = [
  // Code execution
  { pattern: /\beval\s*\(/, name: "eval", reason: "Code execution via eval()" },
  {
    pattern: /new\s+Function\s*\(/,
    name: "Function constructor",
    reason: "Code execution via Function constructor",
  },
  {
    pattern: /setTimeout\s*\(\s*["'`]/,
    name: "setTimeout string",
    reason: "Code execution via setTimeout string",
  },
  {
    pattern: /setInterval\s*\(\s*["'`]/,
    name: "setInterval string",
    reason: "Code execution via setInterval string",
  },

  // DOM manipulation (XSS vectors)
  {
    pattern: /\.innerHTML\s*=/,
    name: "innerHTML",
    reason: "XSS risk via innerHTML",
  },
  {
    pattern: /\.outerHTML\s*=/,
    name: "outerHTML",
    reason: "XSS risk via outerHTML",
  },
  {
    pattern: /document\.write/,
    name: "document.write",
    reason: "DOM manipulation via document.write",
  },
  {
    pattern: /\.insertAdjacentHTML\s*\(/,
    name: "insertAdjacentHTML",
    reason: "XSS risk via insertAdjacentHTML",
  },

  // Storage access (should use API)
  {
    pattern: /\blocalStorage\b/,
    name: "localStorage",
    reason: "Direct localStorage access (use storage API)",
  },
  {
    pattern: /\bsessionStorage\b/,
    name: "sessionStorage",
    reason: "sessionStorage access not allowed",
  },
  {
    pattern: /\bindexedDB\b/,
    name: "indexedDB",
    reason: "Direct IndexedDB access not allowed",
  },

  // Cookie access
  {
    pattern: /document\.cookie/,
    name: "document.cookie",
    reason: "Cookie access not allowed",
  },

  // Navigation
  {
    pattern: /\blocation\s*=/,
    name: "location assignment",
    reason: "Navigation not allowed",
  },
  {
    pattern: /location\.href\s*=/,
    name: "location.href",
    reason: "Navigation not allowed",
  },
  {
    pattern: /location\.replace\s*\(/,
    name: "location.replace",
    reason: "Navigation not allowed",
  },
  {
    pattern: /location\.assign\s*\(/,
    name: "location.assign",
    reason: "Navigation not allowed",
  },

  // Window manipulation
  {
    pattern: /window\.open\s*\(/,
    name: "window.open",
    reason: "Popup windows not allowed",
  },
  {
    pattern: /window\.close\s*\(/,
    name: "window.close",
    reason: "Window manipulation not allowed",
  },

  // Prototype pollution
  {
    pattern: /__proto__/,
    name: "__proto__",
    reason: "Prototype access not allowed",
  },
  {
    pattern: /Object\.setPrototypeOf/,
    name: "setPrototypeOf",
    reason: "Prototype manipulation not allowed",
  },
  {
    pattern: /Object\.defineProperty/,
    name: "defineProperty",
    reason: "Property definition on globals not allowed",
  },

  // Import attempts (plugins should be self-contained)
  {
    pattern: /\bimport\s*\(/,
    name: "dynamic import",
    reason: "Dynamic imports not allowed",
  },
  {
    pattern: /\brequire\s*\(/,
    name: "require",
    reason: "CommonJS require not allowed",
  },
  {
    pattern: /importScripts\s*\(/,
    name: "importScripts",
    reason: "Web Worker imports not allowed",
  },
];

/**
 * Scan code for dangerous patterns
 */
export function scanForDangerousPatterns(code: string): {
  safe: boolean;
  violations: Array<{ name: string; reason: string; line?: number }>;
} {
  const violations: Array<{ name: string; reason: string; line?: number }> = [];
  const lines = code.split("\n");

  for (const { pattern, name, reason } of DANGEROUS_PATTERNS) {
    // Check each line for the pattern
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        // Check if it's in a comment
        const line = lines[i];
        const commentIndex = Math.min(
          line.indexOf("//") === -1 ? Infinity : line.indexOf("//"),
          line.indexOf("/*") === -1 ? Infinity : line.indexOf("/*")
        );

        const match = line.match(pattern);
        if (match && match.index !== undefined && match.index < commentIndex) {
          violations.push({ name, reason, line: i + 1 });
        }
      }
    }
  }

  return {
    safe: violations.length === 0,
    violations,
  };
}

/**
 * List of globals that should be restricted in the sandbox
 */
export const RESTRICTED_GLOBALS = [
  // Storage
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "caches",

  // Network (should use API)
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",

  // Workers
  "Worker",
  "SharedWorker",
  "ServiceWorker",

  // Dangerous APIs
  "eval",
  "Function",

  // Browser APIs
  "navigator",
  "history",
  "location",
  "document",
  "window",

  // Misc
  "opener",
  "parent",
  "top",
  "frames",
];

/**
 * Generate code to restrict globals in sandbox
 */
export function generateGlobalRestrictions(): string {
  const restrictions = RESTRICTED_GLOBALS.map((name) => {
    return `
      try {
        Object.defineProperty(window, '${name}', {
          get: function() { throw new Error('Access to ${name} is restricted'); },
          configurable: false
        });
      } catch(e) {}
    `;
  }).join("\n");

  return `(function() { ${restrictions} })();`;
}

/**
 * Validate plugin code before execution
 */
export function validatePluginCode(code: string): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for dangerous patterns
  const scanResult = scanForDangerousPatterns(code);
  if (!scanResult.safe) {
    for (const violation of scanResult.violations) {
      errors.push(
        `Line ${violation.line ?? "?"}: ${violation.reason} (${violation.name})`
      );
    }
  }

  // Check code size
  const codeSize = new Blob([code]).size;
  if (codeSize > 5 * 1024 * 1024) {
    errors.push("Plugin code exceeds 5MB limit");
  } else if (codeSize > 1 * 1024 * 1024) {
    warnings.push("Plugin code is larger than 1MB, which may affect performance");
  }

  // Check for minified code (heuristic: very long lines)
  const lines = code.split("\n");
  const longLines = lines.filter((line) => line.length > 1000);
  if (longLines.length > lines.length * 0.5) {
    warnings.push(
      "Plugin appears to be minified, which makes security review difficult"
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
