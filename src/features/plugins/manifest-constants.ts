/**
 * The manifest's plain vocabulary, kept apart from `manifest-schema.ts` so the
 * contributions read side can type its targets without importing Zod (#437).
 * The values are the single source of truth; the manifest schema builds its
 * enums from them. The locale application below is pure and Zod-free too, so
 * the Settings card can localize a manifest name without the validator.
 */
import { LOCAL_ID_PATTERN } from "@/features/plugins/ids";
import type { PluginLocale, PluginManifest } from "@/features/plugins/types";
import type { Language } from "@/features/settings/types";

/** The languages a manifest's literal strings and its `locales/` files may use. */
export const MANIFEST_LANGUAGES = ["en", "es"] as const satisfies readonly Language[];

/** The item kinds a contributed Command may act on (the v1 API entities). */
export const PLUGIN_TARGETS = ["book", "chapter", "note", "canvas", "canvasNode"] as const;

type LocaleFieldKind = "string" | "list";

/** The value a locale override carries: the kind says which one. */
type LocaleFieldValue = string | readonly string[];

/**
 * One localizable manifest field: the kind of override it takes, and a write
 * bound to the manifest the field was found in. This is the one description of
 * the locale field-path grammar — `parsePluginLocale` reads `kind`, and
 * `applyPluginLocale` resolves it again against its own copy and calls `write`.
 */
export interface LocaleField {
  readonly kind: LocaleFieldKind;
  readonly write: (value: LocaleFieldValue) => void;
}

/** The field a locale path names, or null when the path resolves to nothing. */
export function localeField(path: string, manifest: PluginManifest): LocaleField | null {
  if (path === "name" || path === "description") {
    return {
      kind: "string",
      write: (value) => {
        if (typeof value === "string") manifest[path] = value;
      },
    };
  }
  const parts = path.split(".");
  if (parts.length !== 3 || !LOCAL_ID_PATTERN.test(parts[1])) return null;
  const [section, id, field] = parts;
  if (section === "commands") {
    const command = manifest.contributes?.commands?.find((item) => item.id === id);
    if (command === undefined) return null;
    if (field === "label") {
      return {
        kind: "string",
        write: (value) => {
          if (typeof value === "string") command.label = value;
        },
      };
    }
    if (field === "keywords") {
      return {
        kind: "list",
        write: (value) => {
          if (Array.isArray(value)) command.keywords = [...value];
        },
      };
    }
    return null;
  }
  if (section === "pages") {
    const page = manifest.contributes?.pages?.find((item) => item.id === id);
    if (page === undefined || field !== "title") return null;
    return {
      kind: "string",
      write: (value) => {
        if (typeof value === "string") page.title = value;
      },
    };
  }
  if (section === "settingsRows") {
    const row = manifest.contributes?.settingsRows?.find((item) => item.id === id);
    if (row === undefined) return null;
    if (field === "label" || field === "description") {
      const key = field;
      return {
        kind: "string",
        write: (value) => {
          if (typeof value === "string") row[key] = value;
        },
      };
    }
    if (field === "keywords") {
      return {
        kind: "list",
        write: (value) => {
          if (Array.isArray(value)) row.keywords = [...value];
        },
      };
    }
    return null;
  }
  return null;
}

/**
 * Applies a locale's already-validated overrides to a manifest, returning a new
 * manifest and leaving the input untouched. A path that does not resolve (an
 * `x-*` key included) is ignored; `parsePluginLocale` is what refuses one.
 */
export function applyPluginLocale(manifest: PluginManifest, locale: PluginLocale): PluginManifest {
  const next = structuredClone(manifest);
  for (const [path, value] of Object.entries(locale)) {
    localeField(path, next)?.write(value);
  }
  return next;
}
