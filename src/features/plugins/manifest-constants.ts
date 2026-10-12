/**
 * The manifest's plain vocabulary, kept apart from `manifest-schema.ts` so the
 * contributions read side can type its targets without importing Zod (#437).
 * The values are the single source of truth; the manifest schema builds its
 * enums from them.
 */
import type { Language } from "@/features/settings/types";

/** The languages a manifest's literal strings and its `locales/` files may use. */
export const MANIFEST_LANGUAGES = ["en", "es"] as const satisfies readonly Language[];

/** The item kinds a contributed Command may act on (the v1 API entities). */
export const PLUGIN_TARGETS = ["book", "chapter", "note", "canvas", "canvasNode"] as const;
