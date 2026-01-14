/**
 * Editor API
 *
 * Provides a secure, permission-controlled interface for plugins
 * to interact with the TipTap editor.
 */

import type { Editor } from "@tiptap/core";
import type { EditorAPI, EditorSelection } from "../types";
import { getPermissionManager } from "../security/PermissionManager";

/**
 * Whitelist of editor commands that plugins can execute
 */
const ALLOWED_COMMANDS = [
  // Text formatting
  "toggleBold",
  "toggleItalic",
  "toggleUnderline",
  "toggleStrike",
  "toggleCode",
  "toggleHighlight",
  "setColor",
  "unsetColor",

  // Text alignment
  "setTextAlign",

  // Lists
  "toggleBulletList",
  "toggleOrderedList",
  "sinkListItem",
  "liftListItem",

  // Headings
  "setHeading",
  "toggleHeading",
  "setParagraph",

  // Block elements
  "toggleBlockquote",
  "setHorizontalRule",
  "setHardBreak",

  // History
  "undo",
  "redo",

  // Selection
  "selectAll",
  "deleteSelection",
] as const;

type AllowedCommand = (typeof ALLOWED_COMMANDS)[number];

/**
 * Editor API factory options
 */
export interface EditorAPIOptions {
  pluginId: string;
  getEditor: () => Editor | null;
}

/**
 * Create an Editor API instance for a plugin
 */
export function createEditorAPI(options: EditorAPIOptions): EditorAPI | null {
  const { pluginId, getEditor } = options;
  const permissionManager = getPermissionManager();

  // Check if plugin has any editor permissions
  const canRead =
    permissionManager.hasPermission(pluginId, "editor:read") ||
    permissionManager.hasPermission(pluginId, "editor:write");
  const canWrite = permissionManager.hasPermission(pluginId, "editor:write");
  const canCommands = permissionManager.hasPermission(pluginId, "editor:commands");
  const canSelection = permissionManager.hasPermission(pluginId, "editor:selection");

  if (!canRead) {
    return null;
  }

  /**
   * Get the editor instance or throw
   */
  const assertEditor = (): Editor => {
    const editor = getEditor();
    if (!editor) {
      throw new Error("Editor not available");
    }
    return editor;
  };

  /**
   * Assert write permission
   */
  const assertWrite = (): void => {
    if (!canWrite) {
      throw new Error(`Plugin "${pluginId}" lacks editor:write permission`);
    }
  };

  /**
   * Assert commands permission
   */
  const assertCommands = (): void => {
    if (!canCommands) {
      throw new Error(`Plugin "${pluginId}" lacks editor:commands permission`);
    }
  };

  return {
    // =========================================================================
    // Read Operations
    // =========================================================================

    getContent(): string {
      return assertEditor().getHTML();
    },

    getText(): string {
      return assertEditor().getText();
    },

    getJSON(): Record<string, unknown> {
      return assertEditor().getJSON();
    },

    getSelection(): EditorSelection | null {
      if (!canSelection && !canRead) {
        return null;
      }

      const editor = assertEditor();
      const { from, to } = editor.state.selection;

      // Empty selection
      if (from === to) {
        return { from, to, text: "" };
      }

      return {
        from,
        to,
        text: editor.state.doc.textBetween(from, to),
      };
    },

    getWordCount(): number {
      const editor = assertEditor();
      return editor.storage.characterCount?.words?.() ?? 0;
    },

    getCharacterCount(): number {
      const editor = assertEditor();
      return editor.storage.characterCount?.characters?.() ?? 0;
    },

    // =========================================================================
    // Write Operations
    // =========================================================================

    insertText(text: string): boolean {
      assertWrite();

      // Sanitize input - strip any HTML
      const sanitized = text.replace(/<[^>]*>/g, "");

      return assertEditor().chain().focus().insertContent(sanitized).run();
    },

    insertHTML(html: string): boolean {
      assertWrite();

      // Basic XSS protection - strip script tags and event handlers
      const sanitized = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, "")
        .replace(/\s*on\w+\s*=\s*[^\s>]+/gi, "");

      return assertEditor().chain().focus().insertContent(sanitized).run();
    },

    replaceSelection(content: string): boolean {
      assertWrite();

      const editor = assertEditor();
      const { from, to } = editor.state.selection;

      // If no selection, just insert
      if (from === to) {
        return editor.chain().focus().insertContent(content).run();
      }

      return editor
        .chain()
        .focus()
        .deleteSelection()
        .insertContent(content)
        .run();
    },

    // =========================================================================
    // Command Execution
    // =========================================================================

    executeCommand(command: string, ...args: unknown[]): boolean {
      assertCommands();

      // Check if command is allowed
      if (!ALLOWED_COMMANDS.includes(command as AllowedCommand)) {
        console.warn(
          `Plugin "${pluginId}": command "${command}" is not in the allowed list`
        );
        return false;
      }

      const editor = assertEditor();
      const cmd = (editor.commands as Record<string, unknown>)[command];

      if (typeof cmd !== "function") {
        console.warn(`Command "${command}" not found on editor`);
        return false;
      }

      try {
        return (cmd as (...a: unknown[]) => boolean).apply(editor.commands, args);
      } catch (error) {
        console.error(`Error executing command "${command}":`, error);
        return false;
      }
    },

    // =========================================================================
    // Event Subscriptions
    // =========================================================================

    onUpdate(callback: (content: string) => void): () => void {
      const editor = assertEditor();

      const handler = () => {
        try {
          callback(editor.getHTML());
        } catch (error) {
          console.error(`Plugin "${pluginId}" onUpdate callback error:`, error);
        }
      };

      editor.on("update", handler);
      return () => editor.off("update", handler);
    },

    onSelectionUpdate(callback: (selection: EditorSelection) => void): () => void {
      if (!canSelection && !canRead) {
        return () => {};
      }

      const editor = assertEditor();

      const handler = () => {
        try {
          const { from, to } = editor.state.selection;
          callback({
            from,
            to,
            text: from === to ? "" : editor.state.doc.textBetween(from, to),
          });
        } catch (error) {
          console.error(
            `Plugin "${pluginId}" onSelectionUpdate callback error:`,
            error
          );
        }
      };

      editor.on("selectionUpdate", handler);
      return () => editor.off("selectionUpdate", handler);
    },
  };
}

/**
 * Check if a command is in the allowed list
 */
export function isCommandAllowed(command: string): boolean {
  return ALLOWED_COMMANDS.includes(command as AllowedCommand);
}

/**
 * Get the list of allowed commands
 */
export function getAllowedCommands(): readonly string[] {
  return ALLOWED_COMMANDS;
}
