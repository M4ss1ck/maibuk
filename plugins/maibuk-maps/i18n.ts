/**
 * Maps' runtime UI strings: the Plugin-owned en/es catalogs and the lookup its
 * page uses. The host supplies the app language at mount and on every change.
 * The files live in `locales/runtime/` so the host's `locales/<lang>.json`
 * manifest-override files, which refuse unknown keys, stay untouched.
 *
 * This module imports only its own files.
 */

import en from "./locales/runtime/en.json";
import es from "./locales/runtime/es.json";

type Catalog = typeof en;

/** Every runtime string key. */
export type MapsKey = keyof Catalog;

const CATALOGS: Readonly<Record<string, Readonly<Catalog>>> = { en, es };

/** The base subtag of a language tag (`es-MX` becomes `es`). */
export function baseLanguage(language: string): string {
  return language.split(/[-_]/)[0].toLowerCase();
}

/** Looks one runtime string up in the given language, falling back to English. */
export function translate(language: string, key: MapsKey): string {
  const catalog = CATALOGS[baseLanguage(language)] ?? en;
  return catalog[key] ?? en[key];
}

/** Fills `{{name}}` placeholders; an unknown name fills empty. */
export function format(
  template: string,
  values: Readonly<Record<string, string | number>>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
    name in values ? String(values[name]) : ""
  );
}
