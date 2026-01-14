/**
 * Event API
 *
 * Provides a namespaced event system for plugin communication.
 * Plugins can emit and listen to events within their own namespace,
 * and optionally subscribe to global app events.
 */

import type { EventAPI } from "../types";

/**
 * Event listener function type
 */
type EventListener = (...args: unknown[]) => void;

/**
 * Event listener with metadata
 */
interface RegisteredListener {
  pluginId: string;
  event: string;
  callback: EventListener;
}

/**
 * Global event bus for plugin communication
 */
class PluginEventBus {
  private static instance: PluginEventBus | null = null;

  private listeners: Map<string, Set<RegisteredListener>> = new Map();

  private constructor() {}

  static getInstance(): PluginEventBus {
    if (!PluginEventBus.instance) {
      PluginEventBus.instance = new PluginEventBus();
    }
    return PluginEventBus.instance;
  }

  /**
   * Subscribe to an event
   */
  on(
    event: string,
    pluginId: string,
    callback: EventListener
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    const listener: RegisteredListener = { pluginId, event, callback };
    this.listeners.get(event)!.add(listener);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(listener);
    };
  }

  /**
   * Emit an event
   */
  emit(event: string, ...args: unknown[]): void {
    const listeners = this.listeners.get(event);
    if (!listeners) return;

    listeners.forEach((listener) => {
      try {
        listener.callback(...args);
      } catch (error) {
        console.error(
          `Error in event listener for "${event}" (plugin: ${listener.pluginId}):`,
          error
        );
      }
    });
  }

  /**
   * Remove all listeners for a plugin
   */
  removePluginListeners(pluginId: string): void {
    for (const [event, listeners] of this.listeners) {
      for (const listener of listeners) {
        if (listener.pluginId === pluginId) {
          listeners.delete(listener);
        }
      }
      // Clean up empty sets
      if (listeners.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * Remove all listeners for a specific event
   */
  removeEventListeners(event: string): void {
    this.listeners.delete(event);
  }

  /**
   * Clear all listeners
   */
  clear(): void {
    this.listeners.clear();
  }

  /**
   * Get listener count for an event
   */
  getListenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /**
   * Get all events with listeners
   */
  getActiveEvents(): string[] {
    return Array.from(this.listeners.keys());
  }
}

/**
 * Event API factory options
 */
export interface EventAPIOptions {
  pluginId: string;
}

/**
 * Create an Event API instance for a plugin
 */
export function createEventAPI(options: EventAPIOptions): EventAPI {
  const { pluginId } = options;
  const eventBus = PluginEventBus.getInstance();

  // Track subscriptions for cleanup
  const subscriptions: Array<() => void> = [];

  return {
    /**
     * Subscribe to an event
     *
     * Events are namespaced to the plugin by default.
     * Use "global:" prefix to listen to app-wide events.
     */
    on(event: string, callback: EventListener): () => void {
      // Validate event name
      if (!event || typeof event !== "string") {
        console.warn(`Plugin "${pluginId}": Invalid event name`);
        return () => {};
      }

      // Limit event name length
      if (event.length > 100) {
        console.warn(`Plugin "${pluginId}": Event name too long`);
        return () => {};
      }

      // Determine if it's a global or namespaced event
      let fullEvent: string;
      if (event.startsWith("global:")) {
        // Global events - allowed to listen but not emit
        fullEvent = event;
      } else {
        // Namespace to plugin
        fullEvent = `plugin:${pluginId}:${event}`;
      }

      // Wrap callback with error handling
      const safeCallback: EventListener = (...args) => {
        try {
          callback(...args);
        } catch (error) {
          console.error(
            `Plugin "${pluginId}" error in event handler for "${event}":`,
            error
          );
        }
      };

      const unsubscribe = eventBus.on(fullEvent, pluginId, safeCallback);
      subscriptions.push(unsubscribe);

      return () => {
        unsubscribe();
        const index = subscriptions.indexOf(unsubscribe);
        if (index !== -1) {
          subscriptions.splice(index, 1);
        }
      };
    },

    /**
     * Emit an event
     *
     * Plugins can only emit events in their own namespace.
     * Global events (global:*) can only be emitted by the app.
     */
    emit(event: string, ...args: unknown[]): void {
      // Validate event name
      if (!event || typeof event !== "string") {
        console.warn(`Plugin "${pluginId}": Invalid event name`);
        return;
      }

      // Limit event name length
      if (event.length > 100) {
        console.warn(`Plugin "${pluginId}": Event name too long`);
        return;
      }

      // Prevent emitting global events
      if (event.startsWith("global:")) {
        console.warn(
          `Plugin "${pluginId}": Cannot emit global events, only subscribe to them`
        );
        return;
      }

      // Namespace to plugin
      const fullEvent = `plugin:${pluginId}:${event}`;

      // Serialize args to prevent object mutations affecting other listeners
      let safeArgs: unknown[];
      try {
        safeArgs = JSON.parse(JSON.stringify(args));
      } catch {
        // If serialization fails, use original args
        safeArgs = args;
      }

      eventBus.emit(fullEvent, ...safeArgs);
    },
  };
}

/**
 * Get the global event bus instance
 */
export function getEventBus(): PluginEventBus {
  return PluginEventBus.getInstance();
}

/**
 * Emit a global event (app only, not for plugins)
 */
export function emitGlobalEvent(event: string, ...args: unknown[]): void {
  const fullEvent = `global:${event}`;
  PluginEventBus.getInstance().emit(fullEvent, ...args);
}

/**
 * Clear all event listeners for a plugin
 */
export function clearPluginEvents(pluginId: string): void {
  PluginEventBus.getInstance().removePluginListeners(pluginId);
}

/**
 * Predefined global events that plugins can subscribe to
 */
export const GlobalEvents = {
  // Editor events
  EDITOR_READY: "global:editor:ready",
  EDITOR_FOCUS: "global:editor:focus",
  EDITOR_BLUR: "global:editor:blur",

  // Document events
  DOCUMENT_SAVE: "global:document:save",
  DOCUMENT_LOAD: "global:document:load",

  // Chapter events
  CHAPTER_CHANGE: "global:chapter:change",

  // Book events
  BOOK_OPEN: "global:book:open",
  BOOK_CLOSE: "global:book:close",

  // App events
  APP_READY: "global:app:ready",
  THEME_CHANGE: "global:theme:change",
} as const;
