/**
 * MCP Server's runtime UI strings: the Plugin-owned en/es catalogs the page
 * reads and the tiny lookup it uses. The host owns neither the catalog nor its
 * keys; it only supplies the app language, at startup and on every change, and
 * the page re-renders from the new value. The files live in `locales/runtime/`
 * so the host's `locales/<lang>.json` manifest-override contract, which those
 * sibling files still serve, is untouched by runtime keys it would refuse.
 *
 * This module imports only its own files.
 */

import en from "./locales/runtime/en.json";
import es from "./locales/runtime/es.json";

/** One shipped catalog, exactly as its JSON file is shaped. */
type Catalog = typeof en;

/** Every runtime string key. */
export type McpKey = keyof Catalog;

const CATALOGS: Readonly<Record<string, Readonly<Catalog>>> = { en, es };

/** The base subtag of a language tag, lower-cased (`es-MX` reads `es`). */
function baseLanguage(language: string): string {
  return language.split(/[-_]/)[0].toLowerCase();
}

/** The catalog for a language tag, following the base subtag and falling back to English. */
export function catalogFor(language: string): Readonly<Catalog> {
  return CATALOGS[baseLanguage(language)] ?? en;
}

/** Looks one runtime string up in the language the host signals. */
export function translate(language: string, key: McpKey): string {
  const value = catalogFor(language)[key];
  return typeof value === "string" ? value : key;
}
