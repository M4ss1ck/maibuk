/**
 * Echoes' runtime UI strings: the Plugin-owned en/es catalogs and the tiny
 * lookup its pages use. The host owns neither the catalog nor its keys (#415);
 * it only supplies the app language, at startup and on every change, and the
 * page re-renders from the new value. The files live in `locales/runtime/` so
 * the host's `locales/<lang>.json` manifest-override contract, which those
 * sibling files still serve, is untouched by runtime keys it would refuse.
 *
 * A string that carries a count ships its forms under `_one` / `_other` (the
 * CLDR categories Intl.PluralRules selects for en and es); every other string
 * ships a single key. A count-less lookup of a plural key reads `_other`.
 *
 * This module imports only its own files.
 */

import { baseLanguage } from "./language";
import en from "./locales/runtime/en.json";
import es from "./locales/runtime/es.json";

/** One shipped catalog, exactly as its JSON file is shaped. */
type Catalog = typeof en;

/** A plural string's base key; a plain key stands for itself. */
type LogicalKey<Key extends string> = Key extends `${infer Base}_one`
  ? Base
  : Key extends `${infer Base}_other`
    ? Base
    : Key;

/** Every runtime string key: a plural string's base, or a plain key. */
export type EchoKey = LogicalKey<keyof Catalog>;

const CATALOGS: Readonly<Record<string, Readonly<Catalog>>> = { en, es };

/** The catalog for a language tag, following the base subtag and falling back to English. */
export function catalogFor(language: string): Readonly<Catalog> {
  return CATALOGS[baseLanguage(language)] ?? en;
}

const PLURAL_RULES = new Map<string, Intl.PluralRules>();

/** The CLDR plural category ("one", "other", …) Intl.PluralRules picks for a count. */
export function pluralCategory(language: string, count: number): Intl.LDMLPluralRule {
  const base = baseLanguage(language);
  let rules = PLURAL_RULES.get(base);
  if (rules === undefined) {
    rules = new Intl.PluralRules(base);
    PLURAL_RULES.set(base, rules);
  }
  return rules.select(count);
}

/**
 * Looks one runtime string up in the language the host signals. With a `count`,
 * a plural string resolves to its `_one` / `_other` form for that count's
 * category; a missing form falls back to `_other`, then to the key itself.
 */
export function translate(language: string, key: EchoKey, count?: number): string {
  const catalog = catalogFor(language) as Readonly<Record<string, string>>;
  const candidates =
    count === undefined
      ? [`${key}_other`, key]
      : [`${key}_${pluralCategory(language, count)}`, `${key}_other`, key];
  for (const candidate of candidates) {
    const value = catalog[candidate];
    if (typeof value === "string") return value;
  }
  return key;
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
