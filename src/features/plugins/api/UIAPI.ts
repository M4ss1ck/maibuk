/**
 * UI API
 *
 * Provides a secure interface for plugins to interact with the Maibuk UI.
 * Includes notifications, modals, toolbar buttons, and sidebar panels.
 */

import type {
  UIAPI,
  NotificationType,
  ModalConfig,
  ToolbarButtonConfig,
  SidebarPanelConfig,
} from "../types";
import { getPermissionManager } from "../security/PermissionManager";

/**
 * Registered toolbar buttons from plugins
 */
interface RegisteredToolbarButton {
  pluginId: string;
  id: string;
  config: ToolbarButtonConfig & { onClick: () => void };
}

/**
 * Registered sidebar panels from plugins
 */
interface RegisteredSidebarPanel {
  pluginId: string;
  id: string;
  config: SidebarPanelConfig & { component: React.ComponentType };
}

/**
 * UI Registry - stores registered UI elements from plugins
 */
class UIRegistry {
  private static instance: UIRegistry | null = null;

  private toolbarButtons: Map<string, RegisteredToolbarButton> = new Map();
  private sidebarPanels: Map<string, RegisteredSidebarPanel> = new Map();
  private listeners: Set<() => void> = new Set();

  private constructor() {}

  static getInstance(): UIRegistry {
    if (!UIRegistry.instance) {
      UIRegistry.instance = new UIRegistry();
    }
    return UIRegistry.instance;
  }

  /**
   * Register a toolbar button
   */
  registerToolbarButton(
    pluginId: string,
    config: ToolbarButtonConfig & { onClick: () => void }
  ): string {
    const id = `${pluginId}:toolbar:${Date.now()}`;
    this.toolbarButtons.set(id, { pluginId, id, config });
    this.notifyListeners();
    return id;
  }

  /**
   * Unregister a toolbar button
   */
  unregisterToolbarButton(id: string): void {
    this.toolbarButtons.delete(id);
    this.notifyListeners();
  }

  /**
   * Unregister all toolbar buttons for a plugin
   */
  unregisterPluginToolbarButtons(pluginId: string): void {
    for (const [id, button] of this.toolbarButtons) {
      if (button.pluginId === pluginId) {
        this.toolbarButtons.delete(id);
      }
    }
    this.notifyListeners();
  }

  /**
   * Get all registered toolbar buttons
   */
  getToolbarButtons(): RegisteredToolbarButton[] {
    return Array.from(this.toolbarButtons.values());
  }

  /**
   * Register a sidebar panel
   */
  registerSidebarPanel(
    pluginId: string,
    config: SidebarPanelConfig & { component: React.ComponentType }
  ): string {
    const id = `${pluginId}:panel:${Date.now()}`;
    this.sidebarPanels.set(id, { pluginId, id, config });
    this.notifyListeners();
    return id;
  }

  /**
   * Unregister a sidebar panel
   */
  unregisterSidebarPanel(id: string): void {
    this.sidebarPanels.delete(id);
    this.notifyListeners();
  }

  /**
   * Unregister all sidebar panels for a plugin
   */
  unregisterPluginSidebarPanels(pluginId: string): void {
    for (const [id, panel] of this.sidebarPanels) {
      if (panel.pluginId === pluginId) {
        this.sidebarPanels.delete(id);
      }
    }
    this.notifyListeners();
  }

  /**
   * Get all registered sidebar panels
   */
  getSidebarPanels(): RegisteredSidebarPanel[] {
    return Array.from(this.sidebarPanels.values());
  }

  /**
   * Subscribe to registry changes
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify all listeners of changes
   */
  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        console.error("UI Registry listener error:", error);
      }
    });
  }

  /**
   * Clear all registrations for a plugin
   */
  clearPlugin(pluginId: string): void {
    this.unregisterPluginToolbarButtons(pluginId);
    this.unregisterPluginSidebarPanels(pluginId);
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    this.toolbarButtons.clear();
    this.sidebarPanels.clear();
    this.notifyListeners();
  }
}

/**
 * Notification handler type
 */
type NotificationHandler = (message: string, type: NotificationType) => void;

/**
 * Modal handler type
 */
type ModalHandler = (config: ModalConfig) => Promise<unknown>;

/**
 * UI API handlers - set by the app to connect to actual UI
 */
let notificationHandler: NotificationHandler | null = null;
let modalHandler: ModalHandler | null = null;

/**
 * Set the notification handler (called by app initialization)
 */
export function setNotificationHandler(handler: NotificationHandler): void {
  notificationHandler = handler;
}

/**
 * Set the modal handler (called by app initialization)
 */
export function setModalHandler(handler: ModalHandler): void {
  modalHandler = handler;
}

/**
 * UI API factory options
 */
export interface UIAPIOptions {
  pluginId: string;
}

/**
 * Create a UI API instance for a plugin
 */
export function createUIAPI(options: UIAPIOptions): UIAPI | null {
  const { pluginId } = options;
  const permissionManager = getPermissionManager();
  const registry = UIRegistry.getInstance();

  // Check UI permissions
  const canNotify = permissionManager.hasPermission(pluginId, "ui:notification");
  const canModal = permissionManager.hasPermission(pluginId, "ui:modal");
  const canToolbar = permissionManager.hasPermission(pluginId, "ui:toolbar");
  const canPanel = permissionManager.hasPermission(pluginId, "ui:panel");

  // If no UI permissions, return null
  if (!canNotify && !canModal && !canToolbar && !canPanel) {
    return null;
  }

  return {
    showNotification(message: string, type: NotificationType = "info"): void {
      if (!canNotify) {
        console.warn(`Plugin "${pluginId}" lacks ui:notification permission`);
        return;
      }

      // Sanitize message
      const sanitizedMessage = String(message).slice(0, 500);

      if (notificationHandler) {
        try {
          notificationHandler(sanitizedMessage, type);
        } catch (error) {
          console.error("Notification handler error:", error);
        }
      } else {
        // Fallback to console
        const logMethod =
          type === "error"
            ? console.error
            : type === "warning"
              ? console.warn
              : console.log;
        logMethod(`[Plugin: ${pluginId}] ${sanitizedMessage}`);
      }
    },

    async showModal(config: ModalConfig): Promise<unknown> {
      if (!canModal) {
        console.warn(`Plugin "${pluginId}" lacks ui:modal permission`);
        return null;
      }

      if (!modalHandler) {
        console.warn("Modal handler not set");
        return null;
      }

      try {
        // Sanitize config
        const sanitizedConfig: ModalConfig = {
          title: String(config.title).slice(0, 100),
          content: config.content,
          actions: config.actions?.slice(0, 4).map((action) => ({
            ...action,
            label: String(action.label).slice(0, 50),
          })),
        };

        return await modalHandler(sanitizedConfig);
      } catch (error) {
        console.error("Modal handler error:", error);
        return null;
      }
    },

    registerToolbarButton(
      config: ToolbarButtonConfig & { onClick: () => void }
    ): () => void {
      if (!canToolbar) {
        console.warn(`Plugin "${pluginId}" lacks ui:toolbar permission`);
        return () => {};
      }

      // Validate config
      if (!config.icon || !config.tooltip) {
        console.warn(`Plugin "${pluginId}": Invalid toolbar button config`);
        return () => {};
      }

      const id = registry.registerToolbarButton(pluginId, {
        icon: String(config.icon).slice(0, 100),
        tooltip: String(config.tooltip).slice(0, 100),
        position: config.position,
        onClick: () => {
          try {
            config.onClick();
          } catch (error) {
            console.error(`Plugin "${pluginId}" toolbar button error:`, error);
          }
        },
      });

      return () => registry.unregisterToolbarButton(id);
    },

    registerSidebarPanel(
      config: SidebarPanelConfig & { component: React.ComponentType }
    ): () => void {
      if (!canPanel) {
        console.warn(`Plugin "${pluginId}" lacks ui:panel permission`);
        return () => {};
      }

      // Validate config
      if (!config.title || !config.icon || !config.component) {
        console.warn(`Plugin "${pluginId}": Invalid sidebar panel config`);
        return () => {};
      }

      const id = registry.registerSidebarPanel(pluginId, {
        title: String(config.title).slice(0, 50),
        icon: String(config.icon).slice(0, 100),
        component: config.component,
      });

      return () => registry.unregisterSidebarPanel(id);
    },
  };
}

/**
 * Get the UI registry instance
 */
export function getUIRegistry(): UIRegistry {
  return UIRegistry.getInstance();
}

/**
 * Clear all UI registrations for a plugin (called on unload)
 */
export function clearPluginUI(pluginId: string): void {
  UIRegistry.getInstance().clearPlugin(pluginId);
}
