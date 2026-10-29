/**
 * Reader's runtime UI strings: the Plugin-owned en/es catalogs and the tiny
 * lookup the Shelf page uses. The host supplies the app language, at mount and
 * on every change, and the page re-renders from the new value. The files live
 * in `locales/runtime/` so the host's `locales/<lang>.json` manifest-override
 * contract, which its sibling files serve, is untouched by runtime keys it
 * would refuse.
 *
 * This module imports only its own files.
 */

import { baseLanguage } from "./language";
import en from "./locales/runtime/en.json";
import es from "./locales/runtime/es.json";

/** One shipped catalog, exactly as its JSON file is shaped. */
type Catalog = typeof en;

/** Every runtime string key. */
export type ReaderKey = keyof Catalog;

const CATALOGS: Readonly<Record<string, Readonly<Catalog>>> = { en, es };

/** The catalog for a language tag, following the base subtag and falling back to English. */
export function catalogFor(language: string): Readonly<Catalog> {
  return CATALOGS[baseLanguage(language)] ?? en;
}

/** Looks one runtime string up in the language the host signals. */
export function translate(language: string, key: ReaderKey): string {
  const catalog = catalogFor(language) as Readonly<Record<string, string>>;
  const value = catalog[key];
  return typeof value === "string" ? value : key;
}

/** The `{{name}}` placeholders a template carries, and its literal parts. */
type TemplateValues = Readonly<Record<string, string | number>>;
const TEMPLATE_PATTERN = /\{\{(\w+)\}\}/g;

/** Fills `{{name}}` placeholders in a runtime string; an unknown name fills empty. */
export function format(template: string, values: TemplateValues): string {
  return template.replace(TEMPLATE_PATTERN, (_match, name: string) =>
    name in values ? String(values[name]) : ""
  );
}
