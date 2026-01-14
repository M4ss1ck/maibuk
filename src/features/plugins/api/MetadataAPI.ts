/**
 * Metadata API
 *
 * Provides read-only access to book and chapter metadata for plugins.
 */

import type { MetadataAPI } from "../types";
import { getPermissionManager } from "../security/PermissionManager";

/**
 * Book metadata provider function type
 */
export type BookMetadataProvider = () => {
  title: string | null;
  author: string | null;
  description: string | null;
};

/**
 * Chapter metadata provider function type
 */
export type ChapterMetadataProvider = () => {
  title: string | null;
  count: number;
  currentIndex: number;
};

/**
 * Metadata providers - set by the app
 */
let bookMetadataProvider: BookMetadataProvider | null = null;
let chapterMetadataProvider: ChapterMetadataProvider | null = null;

/**
 * Set the book metadata provider (called by app initialization)
 */
export function setBookMetadataProvider(provider: BookMetadataProvider): void {
  bookMetadataProvider = provider;
}

/**
 * Set the chapter metadata provider (called by app initialization)
 */
export function setChapterMetadataProvider(provider: ChapterMetadataProvider): void {
  chapterMetadataProvider = provider;
}

/**
 * Metadata API factory options
 */
export interface MetadataAPIOptions {
  pluginId: string;
}

/**
 * Create a Metadata API instance for a plugin
 */
export function createMetadataAPI(options: MetadataAPIOptions): MetadataAPI | null {
  const { pluginId } = options;
  const permissionManager = getPermissionManager();

  // Check metadata permissions
  const canReadBook = permissionManager.hasPermission(pluginId, "book:metadata");
  const canReadChapters = permissionManager.hasPermission(pluginId, "chapters:read");

  // If no metadata permissions, return null
  if (!canReadBook && !canReadChapters) {
    return null;
  }

  return {
    getBookTitle(): string | null {
      if (!canReadBook) {
        console.warn(`Plugin "${pluginId}" lacks book:metadata permission`);
        return null;
      }

      if (!bookMetadataProvider) {
        return null;
      }

      try {
        return bookMetadataProvider().title;
      } catch (error) {
        console.error("Error getting book title:", error);
        return null;
      }
    },

    getBookAuthor(): string | null {
      if (!canReadBook) {
        console.warn(`Plugin "${pluginId}" lacks book:metadata permission`);
        return null;
      }

      if (!bookMetadataProvider) {
        return null;
      }

      try {
        return bookMetadataProvider().author;
      } catch (error) {
        console.error("Error getting book author:", error);
        return null;
      }
    },

    getChapterTitle(): string | null {
      if (!canReadChapters) {
        console.warn(`Plugin "${pluginId}" lacks chapters:read permission`);
        return null;
      }

      if (!chapterMetadataProvider) {
        return null;
      }

      try {
        return chapterMetadataProvider().title;
      } catch (error) {
        console.error("Error getting chapter title:", error);
        return null;
      }
    },

    getChapterCount(): number {
      if (!canReadChapters) {
        console.warn(`Plugin "${pluginId}" lacks chapters:read permission`);
        return 0;
      }

      if (!chapterMetadataProvider) {
        return 0;
      }

      try {
        return chapterMetadataProvider().count;
      } catch (error) {
        console.error("Error getting chapter count:", error);
        return 0;
      }
    },
  };
}
