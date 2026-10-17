/**
 * Echoes' runtime UI strings: the Plugin-owned en/es catalogs and the tiny
 * lookup its pages use. The host owns neither the catalog nor its keys (#415);
 * it only supplies the app language, at startup and on every change, and the
 * page re-renders from the new value. The files live in `locales/runtime/` so
 * the host's `locales/<lang>.json` manifest-override contract, which those
 * sibling files still serve, is untouched by runtime keys it would refuse.
 *
 * A string that carries a count ships its forms under `_one` / `_other` (the
 * categories `pluralCategory` selects for en and es); every other string ships a
 * single key. A count-less lookup of a plural key reads `_other`.
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

/** The plural categories Echoes' shipped catalogs use (`_one` / `_other`). */
export type PluralCategory = "one" | "other";

/**
 * CLDR cardinal rules for the two shipped languages, written out because the
 * Android QuickJS global set has no `Intl`. Both languages select "one" for the
 * integer 1 (in magnitude) and "other" for everything else Echoes counts. Spanish
 * CLDR also has a "many" form for exact multiples of a million, but no shipped
 * key carries one, so `translate()` reads `_other` for it, as Intl would.
 */
const CARDINAL_RULES: Readonly<Record<string, (count: number) => PluralCategory>> = {
  en: (count) => (Math.abs(count) === 1 ? "one" : "other"),
  es: (count) => (Math.abs(count) === 1 ? "one" : "other"),
};

/** The CLDR plural category ("one" or "other") for a count, in the language's rule. */
export function pluralCategory(language: string, count: number): PluralCategory {
  const rule = CARDINAL_RULES[baseLanguage(language)] ?? CARDINAL_RULES.en;
  return rule(count);
}

/**
 * Looks one runtime string up in the language the host signals. With a `count`,
 * a plural string resolves to its `_one` / `_other` form for that count's
 * category; a missing form falls back to `_other`, then to the key itself.
 */
export function translate(language: string, key: EchoKey, count?: number): string {
  const catalog = catalogFor(language) as Readonly<Record<string, string>>;
  const other = catalog[`${key}_other`];
  if (count === undefined) {
    if (typeof other === "string") return other;
    const plain = catalog[key];
    return typeof plain === "string" ? plain : key;
  }
  const form = catalog[`${key}_${pluralCategory(language, count)}`];
  if (typeof form === "string") return form;
  if (typeof other === "string") return other;
  const plain = catalog[key];
  return typeof plain === "string" ? plain : key;
}

/** The `{{name}}` placeholders a template carries, and its literal parts. */
type TemplateValues = Readonly<Record<string, string | number>>;
const TEMPLATE_PATTERN = /\{\{(\w+)\}\}/g;
/** Compiled templates by source, so `format` runs no regex per call (#451). */
const TEMPLATE_COMPILERS = new Map<string, (values: TemplateValues) => string>();

/**
 * Precompiles one template into a filler: the `{{name}}` placeholders are
 * found once, so a highlight update fills 10,900 labels with no regex per call.
 * An unknown name fills empty, matching the original `replace` callback.
 */
export function compileTemplate(template: string): (values: TemplateValues) => string {
  const cached = TEMPLATE_COMPILERS.get(template);
  if (cached !== undefined) return cached;
  // Alternates literal, name, literal, name, …, literal; even indices literal.
  const parts: string[] = [];
  let last = 0;
  TEMPLATE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null = TEMPLATE_PATTERN.exec(template);
  while (match !== null) {
    parts.push(template.slice(last, match.index), match[1]);
    last = match.index + match[0].length;
    match = TEMPLATE_PATTERN.exec(template);
  }
  parts.push(template.slice(last));
  const compiled = (values: TemplateValues): string => {
    let out = "";
    for (let index = 0; index < parts.length; index++) {
      if ((index & 1) === 0) out += parts[index];
      else out += parts[index] in values ? String(values[parts[index]]) : "";
    }
    return out;
  };
  TEMPLATE_COMPILERS.set(template, compiled);
  return compiled;
}

/** Fills `{{name}}` placeholders in a runtime string; an unknown name fills empty. */
export function format(template: string, values: TemplateValues): string {
  return compileTemplate(template)(values);
}
