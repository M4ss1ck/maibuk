/**
 * Plugin System Type Definitions
 *
 * This file defines all the core types for the Maibuk plugin system.
 */

// =============================================================================
// Permissions
// =============================================================================

/**
 * Available permissions that plugins can request.
 * Users must approve required permissions before a plugin can be enabled.
 */
export type Permission =
  // Editor permissions
  | "editor:read" // Read editor content, word count, selection
  | "editor:write" // Modify content, execute formatting commands
  | "editor:selection" // Access and manipulate selection
  | "editor:commands" // Execute editor commands

  // Storage permissions
  | "storage:local" // Plugin-scoped localStorage (5MB quota)
  | "storage:book" // Per-book storage

  // Network permissions
  | "network:fetch" // Make HTTPS requests (with domain restrictions)

  // UI permissions
  | "ui:toolbar" // Add toolbar buttons
  | "ui:panel" // Add side panels
  | "ui:modal" // Show modal dialogs
  | "ui:notification" // Show toast notifications

  // Data access permissions
  | "clipboard:read" // Read from clipboard
  | "clipboard:write" // Write to clipboard
  | "settings:read" // Read app settings
  | "book:metadata" // Access book metadata (read-only)
  | "chapters:read" // Read chapter list
  | "export:hook"; // Hook into export process

/**
 * Human-readable permission information for UI display
 */
export interface PermissionInfo {
  label: string;
  description: string;
  risk: "low" | "medium" | "high";
}

/**
 * Permission metadata for displaying in the UI
 */
export const PERMISSION_INFO: Record<Permission, PermissionInfo> = {
  "editor:read": {
    label: "Read Editor Content",
    description: "Access the text content of your documents",
    risk: "low",
  },
  "editor:write": {
    label: "Modify Editor Content",
    description: "Make changes to your documents",
    risk: "medium",
  },
  "editor:selection": {
    label: "Access Selection",
    description: "Read and modify the current text selection",
    risk: "low",
  },
  "editor:commands": {
    label: "Execute Commands",
    description: "Run editor formatting commands",
    risk: "medium",
  },
  "storage:local": {
    label: "Local Storage",
    description: "Store plugin settings and data locally",
    risk: "low",
  },
  "storage:book": {
    label: "Book Storage",
    description: "Store data associated with each book",
    risk: "low",
  },
  "network:fetch": {
    label: "Network Access",
    description: "Send and receive data from the internet",
    risk: "high",
  },
  "ui:toolbar": {
    label: "Toolbar Buttons",
    description: "Add buttons to the editor toolbar",
    risk: "low",
  },
  "ui:panel": {
    label: "Side Panels",
    description: "Add panels to the sidebar",
    risk: "low",
  },
  "ui:modal": {
    label: "Modal Dialogs",
    description: "Show popup dialogs",
    risk: "low",
  },
  "ui:notification": {
    label: "Notifications",
    description: "Show toast notifications",
    risk: "low",
  },
  "clipboard:read": {
    label: "Read Clipboard",
    description: "Access clipboard contents",
    risk: "medium",
  },
  "clipboard:write": {
    label: "Write Clipboard",
    description: "Copy content to clipboard",
    risk: "low",
  },
  "settings:read": {
    label: "Read Settings",
    description: "Access application settings",
    risk: "low",
  },
  "book:metadata": {
    label: "Book Metadata",
    description: "Access book title, author, and other metadata",
    risk: "low",
  },
  "chapters:read": {
    label: "Chapter List",
    description: "Access the list of chapters",
    risk: "low",
  },
  "export:hook": {
    label: "Export Hook",
    description: "Run code during export process",
    risk: "medium",
  },
};

// =============================================================================
// Plugin Types
// =============================================================================

/**
 * The type of plugin, determining how it integrates with Maibuk
 */
export type PluginType =
  | "editor-extension" // TipTap extension (marks, nodes, behaviors)
  | "toolbar" // Toolbar button or menu
  | "panel" // Side panel
  | "export" // Export format
  | "theme"; // UI theme

/**
 * Plugin author information
 */
export interface PluginAuthor {
  name: string;
  email?: string;
  url?: string;
}

/**
 * Toolbar button configuration
 */
export interface ToolbarButtonConfig {
  icon: string; // Icon name or SVG
  tooltip: string;
  position?: "left" | "right";
}

/**
 * Sidebar panel configuration
 */
export interface SidebarPanelConfig {
  title: string;
  icon: string;
}

/**
 * Editor extension configuration (for type === 'editor-extension')
 */
export interface EditorExtensionConfig {
  extensionType: "node" | "mark" | "extension";
  name: string; // TipTap extension name
  priority?: number; // Load order (higher = later)
}

/**
 * UI integration configuration
 */
export interface PluginUIConfig {
  settingsPanel?: boolean; // Plugin has a settings panel
  toolbarButton?: ToolbarButtonConfig;
  sidebarPanel?: SidebarPanelConfig;
}

/**
 * Plugin manifest - the plugin.json file structure
 */
export interface PluginManifest {
  // Required identification
  id: string; // Unique identifier (reverse domain: com.author.pluginname)
  name: string; // Display name
  version: string; // Semver version (e.g., "1.0.0")
  description: string; // Short description

  // Author information
  author: PluginAuthor;

  // Entry point
  main: string; // Entry point file relative to plugin root

  // Plugin type
  type: PluginType;

  // Permissions
  permissions: Permission[]; // Required permissions
  optionalPermissions?: Permission[]; // Optional permissions

  // Version compatibility
  maibukVersion: string; // Minimum Maibuk version (semver range)

  // Dependencies on other plugins
  dependencies?: Record<string, string>; // pluginId -> semver range

  // Editor extension specific config
  editorExtension?: EditorExtensionConfig;

  // UI integration
  ui?: PluginUIConfig;

  // Metadata
  license?: string;
  homepage?: string;
  repository?: string;
  keywords?: string[];

  // Content Security Policy additions
  contentSecurityPolicy?: string;
}

// =============================================================================
// Installed Plugin State
// =============================================================================

/**
 * Represents an installed plugin with its runtime state
 */
export interface InstalledPlugin {
  id: string;
  manifest: PluginManifest;
  enabled: boolean;
  installedAt: number; // Unix timestamp
  updatedAt: number; // Unix timestamp
  grantedPermissions: Permission[];
  settings: Record<string, unknown>; // Plugin-specific settings
  storageUsage: number; // Bytes used in storage
}

/**
 * Plugin error record for logging and display
 */
export interface PluginError {
  pluginId: string;
  error: string;
  timestamp: number; // Unix timestamp
  stack?: string;
}

/**
 * Result of plugin installation attempt
 */
export interface PluginInstallResult {
  success: boolean;
  manifest?: PluginManifest;
  error?: string;
}

/**
 * Validation result for plugin manifests
 */
export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// =============================================================================
// Plugin API Types
// =============================================================================

/**
 * Selection information from the editor
 */
export interface EditorSelection {
  from: number;
  to: number;
  text: string;
}

/**
 * Modal configuration for UI API
 */
export interface ModalConfig {
  title: string;
  content: React.ReactNode | string;
  actions?: ModalAction[];
}

/**
 * Modal action button
 */
export interface ModalAction {
  label: string;
  variant?: "default" | "primary" | "destructive";
  onClick: () => void | Promise<void>;
}

/**
 * Notification types
 */
export type NotificationType = "info" | "success" | "warning" | "error";

// =============================================================================
// Plugin Exports (what plugins provide)
// =============================================================================

/**
 * The exports that a plugin module must provide
 */
export interface PluginExports {
  // TipTap extension (required for editor-extension type)
  extension?: unknown; // TipTap Extension type

  // Lifecycle hooks
  onLoad?: (api: PluginAPI) => void | Promise<void>;
  onUnload?: () => void | Promise<void>;
  onEnable?: () => void | Promise<void>;
  onDisable?: () => void | Promise<void>;

  // UI components (React components)
  SettingsPanel?: React.ComponentType<{ api: PluginAPI }>;
  SidebarPanel?: React.ComponentType<{ api: PluginAPI }>;
  ToolbarButton?: React.ComponentType<{ api: PluginAPI }>;
}

// =============================================================================
// Plugin API (provided to plugins)
// =============================================================================

/**
 * Editor API provided to plugins with editor permissions
 */
export interface EditorAPI {
  // Read operations (requires editor:read)
  getContent(): string;
  getText(): string;
  getJSON(): Record<string, unknown>;
  getSelection(): EditorSelection | null;
  getWordCount(): number;
  getCharacterCount(): number;

  // Write operations (requires editor:write)
  insertText(text: string): boolean;
  insertHTML(html: string): boolean;
  replaceSelection(content: string): boolean;

  // Command execution (requires editor:commands)
  executeCommand(command: string, ...args: unknown[]): boolean;

  // Event subscriptions (requires editor:read)
  onUpdate(callback: (content: string) => void): () => void;
  onSelectionUpdate(
    callback: (selection: EditorSelection) => void
  ): () => void;
}

/**
 * Storage API provided to plugins with storage permissions
 */
export interface StorageAPI {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
  getUsage(): number;
  getQuota(): number;
}

/**
 * UI API provided to plugins with UI permissions
 */
export interface UIAPI {
  showNotification(message: string, type?: NotificationType): void;
  showModal(config: ModalConfig): Promise<unknown>;
  registerToolbarButton(config: ToolbarButtonConfig & { onClick: () => void }): () => void;
  registerSidebarPanel(config: SidebarPanelConfig & { component: React.ComponentType }): () => void;
}

/**
 * Event API for plugin communication
 */
export interface EventAPI {
  on(event: string, callback: (...args: unknown[]) => void): () => void;
  emit(event: string, ...args: unknown[]): void;
}

/**
 * Metadata API for accessing book/chapter info
 */
export interface MetadataAPI {
  getBookTitle(): string | null;
  getBookAuthor(): string | null;
  getChapterTitle(): string | null;
  getChapterCount(): number;
}

/**
 * The complete API object provided to plugins
 */
export interface PluginAPI {
  editor: EditorAPI | null;
  storage: StorageAPI | null;
  ui: UIAPI | null;
  events: EventAPI;
  metadata: MetadataAPI | null;
}
