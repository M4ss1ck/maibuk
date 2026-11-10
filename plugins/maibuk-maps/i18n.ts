/**
 * Maps' runtime UI strings: the Plugin-owned en/es catalogs and the lookup its
 * page uses. The host supplies the app language at mount and on every change.
 * The files live in `locales/runtime/` so the host's `locales/<lang>.json`
 * manifest-override files, which refuse unknown keys, stay untouched.
 *
 * A string that carries a count ships its forms under `_one` / `_other`, the
 * categories both shipped languages use; every other string ships a single key.
 * This module imports only its own files.
 */

import en from "./locales/runtime/en.json";
import es from "./locales/runtime/es.json";

type Catalog = typeof en;

/** A plural string's base key; a plain key stands for itself. */
type LogicalKey<Key extends string> = Key extends `${infer Base}_one`
  ? Base
  : Key extends `${infer Base}_other`
    ? Base
    : Key;

/** Every runtime string key: a plural string's base, or a plain key. */
export type MapsKey = LogicalKey<keyof Catalog>;

const CATALOGS: Readonly<Record<string, Readonly<Catalog>>> = { en, es };

/** The English catalog as a plain lookup, which every other language falls back to. */
const ENGLISH = en as Readonly<Record<string, string>>;

/** The base subtag of a language tag (`es-MX` becomes `es`). */
export function baseLanguage(language: string): string {
  return language.split(/[-_]/)[0].toLowerCase();
}

/** The plural categories Maps' shipped catalogs use (`_one` / `_other`). */
type PluralCategory = "one" | "other";

/**
 * The CLDR cardinal category both shipped languages pick for a count: "one" for
 * a magnitude of exactly 1, "other" for everything else Maps counts. Written
 * out because the Android QuickJS global set has no `Intl`.
 */
function pluralCategory(count: number): PluralCategory {
  return Math.abs(count) === 1 ? "one" : "other";
}

/** One catalog's form for a key: a plural string's form, or a plain key's value. */
function formIn(
  catalog: Readonly<Record<string, string>>,
  key: string,
  category: PluralCategory | null
): string | undefined {
  const other = catalog[`${key}_other`];
  if (category === null) return other ?? catalog[key];
  return catalog[`${key}_${category}`] ?? other ?? catalog[key];
}

/**
 * Looks one runtime string up in the given language, falling back to English.
 * With a `count`, a plural string resolves to the form that count selects.
 */
export function translate(language: string, key: MapsKey, count?: number): string {
  const category = count === undefined ? null : pluralCategory(count);
  const catalog = (CATALOGS[baseLanguage(language)] ?? en) as Readonly<Record<string, string>>;
  return formIn(catalog, key, category) ?? formIn(ENGLISH, key, category) ?? key;
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
