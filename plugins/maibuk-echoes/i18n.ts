/**
 * Echoes' runtime UI strings: the Plugin-owned en/es catalogs and the tiny
 * lookup its pages use. The host owns neither the catalog nor its keys (#415);
 * it only supplies the app language, at startup and on every change, and the
 * page re-renders from the new value. The files live in `locales/runtime/` so
 * the host's `locales/<lang>.json` manifest-override contract, which those
 * sibling files still serve, is untouched by runtime keys it would refuse.
 *
 * This module imports only its own files.
 */

import { baseLanguage } from "./language";
import en from "./locales/runtime/en.json";
import es from "./locales/runtime/es.json";

/** Every runtime string key; the two catalogs must carry exactly these. */
export type EchoKey = keyof typeof en;

const CATALOGS: Readonly<Record<string, Readonly<Record<EchoKey, string>>>> = { en, es };

/** The catalog for a language tag, following the base subtag and falling back to English. */
export function catalogFor(language: string): Readonly<Record<EchoKey, string>> {
  return CATALOGS[baseLanguage(language)] ?? en;
}

/** Looks one runtime string up in the language the host signals. */
export function translate(language: string, key: EchoKey): string {
  return catalogFor(language)[key] ?? en[key];
}

/** Fills `{{name}}` placeholders in a runtime string; an unknown name fills empty. */
export function format(
  template: string,
  values: Readonly<Record<string, string | number>>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
    name in values ? String(values[name]) : ""
  );
}
