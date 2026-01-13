/**
 * Plugin Sandbox
 *
 * Provides a secure, isolated execution environment for plugins using
 * sandboxed iframes and MessageChannel for communication.
 *
 * Security features:
 * - Iframe sandbox attribute restricts capabilities
 * - Content Security Policy limits what code can do
 * - MessageChannel provides secure, async communication
 * - Restricted globals prevent access to sensitive APIs
 * - Timeout prevents infinite loops
 */

import type { Permission, PluginExports, PluginAPI } from "../types";
import {
  generateCSP,
  SANDBOX_ATTRIBUTES,
  generateGlobalRestrictions,
  validatePluginCode,
} from "./SecurityPolicy";

/**
 * Plugin initialization timeout (5 seconds)
 */
const INIT_TIMEOUT_MS = 5000;

/**
 * API call timeout (30 seconds)
 */
const API_CALL_TIMEOUT_MS = 30000;

/**
 * Message types for sandbox communication
 */
type SandboxMessageType =
  | "init"
  | "ready"
  | "error"
  | "api-call"
  | "api-response"
  | "api-error"
  | "event";

/**
 * Message structure for sandbox communication
 */
interface SandboxMessage {
  type: SandboxMessageType;
  callId?: string;
  method?: string;
  args?: unknown[];
  result?: unknown;
  error?: string;
  exports?: SerializedExports;
}

/**
 * Serialized plugin exports (functions become method names)
 */
interface SerializedExports {
  hasExtension: boolean;
  extensionName?: string;
  hasOnLoad: boolean;
  hasOnUnload: boolean;
  hasSettingsPanel: boolean;
  hasSidebarPanel: boolean;
}

/**
 * Pending API call tracker
 */
interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * Plugin Sandbox Class
 *
 * Creates and manages an isolated iframe environment for plugin execution.
 */
export class PluginSandbox {
  private iframe: HTMLIFrameElement | null = null;
  private messageChannel: MessageChannel | null = null;
  private pluginId: string;
  private permissions: Set<Permission>;
  private pendingCalls: Map<string, PendingCall> = new Map();
  private destroyed = false;
  private api: PluginAPI | null = null;

  constructor(pluginId: string, permissions: Permission[]) {
    this.pluginId = pluginId;
    this.permissions = new Set(permissions);
  }

  /**
   * Execute plugin code in the sandbox and return exports
   */
  async execute(code: string, api: PluginAPI): Promise<PluginExports> {
    if (this.destroyed) {
      throw new Error("Sandbox has been destroyed");
    }

    // Validate code before execution
    const validation = validatePluginCode(code);
    if (!validation.valid) {
      throw new Error(`Code validation failed: ${validation.errors.join("; ")}`);
    }

    this.api = api;

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.destroy();
        reject(new Error(`Plugin ${this.pluginId} initialization timed out`));
      }, INIT_TIMEOUT_MS);

      try {
        // Create message channel for communication
        this.messageChannel = new MessageChannel();

        // Set up message handler
        this.messageChannel.port1.onmessage = (event: MessageEvent) => {
          this.handleMessage(event.data as SandboxMessage, resolve, reject, timeout);
        };

        // Create sandboxed iframe
        this.iframe = document.createElement("iframe");
        this.iframe.sandbox.value = SANDBOX_ATTRIBUTES;
        this.iframe.style.display = "none";
        this.iframe.style.width = "0";
        this.iframe.style.height = "0";
        this.iframe.style.border = "none";
        this.iframe.style.position = "absolute";
        this.iframe.style.left = "-9999px";

        // Generate sandbox HTML with CSP and plugin code
        const sandboxHtml = this.generateSandboxHtml(code);
        this.iframe.srcdoc = sandboxHtml;

        // Handle iframe load
        this.iframe.onload = () => {
          if (this.iframe?.contentWindow && this.messageChannel) {
            // Send init message with port
            this.iframe.contentWindow.postMessage(
              { type: "init" },
              "*",
              [this.messageChannel.port2]
            );
          }
        };

        this.iframe.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("Failed to create sandbox iframe"));
        };

        // Add iframe to document
        document.body.appendChild(this.iframe);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  /**
   * Handle messages from the sandbox
   */
  private handleMessage(
    message: SandboxMessage,
    resolveInit: (exports: PluginExports) => void,
    rejectInit: (error: Error) => void,
    initTimeout: ReturnType<typeof setTimeout>
  ): void {
    switch (message.type) {
      case "ready":
        clearTimeout(initTimeout);
        if (message.exports) {
          resolveInit(this.deserializeExports(message.exports));
        } else {
          resolveInit({});
        }
        break;

      case "error":
        clearTimeout(initTimeout);
        rejectInit(new Error(message.error ?? "Unknown plugin error"));
        break;

      case "api-call":
        this.handleApiCall(message);
        break;

      case "api-response":
      case "api-error":
        this.handleApiResponse(message);
        break;

      default:
        console.warn(`Unknown sandbox message type: ${message.type}`);
    }
  }

  /**
   * Handle API call from sandbox
   */
  private async handleApiCall(message: SandboxMessage): Promise<void> {
    if (!message.callId || !message.method) return;

    const { callId, method, args = [] } = message;

    try {
      const result = await this.executeApiMethod(method, args);
      this.sendToSandbox({
        type: "api-response",
        callId,
        result,
      });
    } catch (error) {
      this.sendToSandbox({
        type: "api-error",
        callId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Execute an API method
   */
  private async executeApiMethod(
    method: string,
    args: unknown[]
  ): Promise<unknown> {
    if (!this.api) {
      throw new Error("API not initialized");
    }

    // Parse method path (e.g., "editor.getContent" -> ["editor", "getContent"])
    const parts = method.split(".");
    if (parts.length !== 2) {
      throw new Error(`Invalid API method: ${method}`);
    }

    const [namespace, methodName] = parts;

    // Get the API namespace
    const apiNamespace = this.api[namespace as keyof PluginAPI];
    if (!apiNamespace) {
      throw new Error(`API namespace not available: ${namespace}`);
    }

    // Get the method
    const apiMethod = (apiNamespace as unknown as Record<string, unknown>)[methodName];
    if (typeof apiMethod !== "function") {
      throw new Error(`API method not found: ${method}`);
    }

    // Execute the method
    return await (apiMethod as (...args: unknown[]) => unknown).apply(
      apiNamespace,
      args
    );
  }

  /**
   * Handle API response from sandbox
   */
  private handleApiResponse(message: SandboxMessage): void {
    if (!message.callId) return;

    const pending = this.pendingCalls.get(message.callId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingCalls.delete(message.callId);

    if (message.type === "api-error") {
      pending.reject(new Error(message.error ?? "API call failed"));
    } else {
      pending.resolve(message.result);
    }
  }

  /**
   * Send a message to the sandbox
   */
  private sendToSandbox(message: SandboxMessage): void {
    if (this.messageChannel && !this.destroyed) {
      this.messageChannel.port1.postMessage(message);
    }
  }

  /**
   * Call a method in the sandbox
   */
  async callSandboxMethod(method: string, ...args: unknown[]): Promise<unknown> {
    if (this.destroyed) {
      throw new Error("Sandbox has been destroyed");
    }

    return new Promise((resolve, reject) => {
      const callId = this.generateCallId();

      const timeout = setTimeout(() => {
        this.pendingCalls.delete(callId);
        reject(new Error(`Sandbox method call timed out: ${method}`));
      }, API_CALL_TIMEOUT_MS);

      this.pendingCalls.set(callId, { resolve, reject, timeout });

      this.sendToSandbox({
        type: "api-call",
        callId,
        method,
        args,
      });
    });
  }

  /**
   * Generate sandbox HTML
   */
  private generateSandboxHtml(pluginCode: string): string {
    const csp = generateCSP(Array.from(this.permissions));
    const globalRestrictions = generateGlobalRestrictions();

    // Escape the plugin code for inclusion in HTML
    const escapedCode = pluginCode
      .replace(/\\/g, "\\\\")
      .replace(/`/g, "\\`")
      .replace(/\$/g, "\\$");

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${this.escapeHtml(csp)}">
  <title>Plugin Sandbox: ${this.escapeHtml(this.pluginId)}</title>
</head>
<body>
<script>
(function() {
  'use strict';

  // Restrict dangerous globals
  ${globalRestrictions}

  // Plugin API proxy (will be populated after init)
  let maibukApi = null;
  let messagePort = null;
  const pendingCalls = new Map();

  // Generate unique call ID
  function generateCallId() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  // Create API proxy for calling host methods
  function createApiProxy() {
    const namespaces = ['editor', 'storage', 'ui', 'events', 'metadata'];
    const api = {};

    for (const ns of namespaces) {
      api[ns] = new Proxy({}, {
        get: function(target, prop) {
          if (typeof prop !== 'string') return undefined;

          return function(...args) {
            return new Promise((resolve, reject) => {
              if (!messagePort) {
                reject(new Error('Not connected to host'));
                return;
              }

              const callId = generateCallId();
              const timeout = setTimeout(() => {
                pendingCalls.delete(callId);
                reject(new Error('API call timed out'));
              }, 30000);

              pendingCalls.set(callId, { resolve, reject, timeout });

              messagePort.postMessage({
                type: 'api-call',
                callId: callId,
                method: ns + '.' + prop,
                args: args
              });
            });
          };
        }
      });
    }

    return api;
  }

  // Handle messages from host
  function handleMessage(event) {
    const message = event.data;

    switch (message.type) {
      case 'api-response':
        const successPending = pendingCalls.get(message.callId);
        if (successPending) {
          clearTimeout(successPending.timeout);
          pendingCalls.delete(message.callId);
          successPending.resolve(message.result);
        }
        break;

      case 'api-error':
        const errorPending = pendingCalls.get(message.callId);
        if (errorPending) {
          clearTimeout(errorPending.timeout);
          pendingCalls.delete(message.callId);
          errorPending.reject(new Error(message.error || 'API error'));
        }
        break;
    }
  }

  // Wait for init message with port
  window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'init' && event.ports && event.ports[0]) {
      messagePort = event.ports[0];
      messagePort.onmessage = handleMessage;

      // Create API proxy
      maibukApi = createApiProxy();

      // Execute plugin code
      try {
        const exports = {};
        const module = { exports: exports };

        // Make API available to plugin
        const maibuk = maibukApi;

        // Execute plugin code
        (function(exports, module, maibuk) {
          ${escapedCode}
        })(exports, module, maibuk);

        // Get final exports
        const finalExports = module.exports || exports;

        // Serialize exports info
        const serialized = {
          hasExtension: !!finalExports.extension,
          extensionName: finalExports.extension?.name,
          hasOnLoad: typeof finalExports.onLoad === 'function',
          hasOnUnload: typeof finalExports.onUnload === 'function',
          hasSettingsPanel: !!finalExports.SettingsPanel,
          hasSidebarPanel: !!finalExports.SidebarPanel
        };

        // Store exports for later calls
        window.__pluginExports = finalExports;

        // Send ready message
        messagePort.postMessage({
          type: 'ready',
          exports: serialized
        });

      } catch (error) {
        messagePort.postMessage({
          type: 'error',
          error: error.message || 'Plugin initialization failed'
        });
      }
    }
  });
})();
</script>
</body>
</html>`;
  }

  /**
   * Deserialize exports info into PluginExports
   */
  private deserializeExports(serialized: SerializedExports): PluginExports {
    const exports: PluginExports = {};

    // For extension, we'll need to get it differently
    // since we can't serialize TipTap extensions across iframe boundary
    if (serialized.hasExtension) {
      // Mark that extension exists - actual extension will be handled differently
      exports.extension = { name: serialized.extensionName } as unknown;
    }

    if (serialized.hasOnLoad) {
      exports.onLoad = async (api: PluginAPI) => {
        await this.callSandboxMethod("__pluginExports.onLoad", api);
      };
    }

    if (serialized.hasOnUnload) {
      exports.onUnload = async () => {
        await this.callSandboxMethod("__pluginExports.onUnload");
      };
    }

    return exports;
  }

  /**
   * Generate unique call ID
   */
  private generateCallId(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /**
   * Check if sandbox is active
   */
  isActive(): boolean {
    return !this.destroyed && this.iframe !== null;
  }

  /**
   * Destroy the sandbox
   */
  destroy(): void {
    if (this.destroyed) return;

    this.destroyed = true;

    // Clear pending calls
    for (const [, pending] of this.pendingCalls) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Sandbox destroyed"));
    }
    this.pendingCalls.clear();

    // Close message channel
    if (this.messageChannel) {
      this.messageChannel.port1.close();
      this.messageChannel = null;
    }

    // Remove iframe
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }

    this.api = null;
  }
}

/**
 * Create a new plugin sandbox
 */
export function createSandbox(
  pluginId: string,
  permissions: Permission[]
): PluginSandbox {
  return new PluginSandbox(pluginId, permissions);
}
