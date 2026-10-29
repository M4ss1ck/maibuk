/** The base subtag of a language tag (`es-MX` becomes `es`), as the host sends it. */
export function baseLanguage(language: string): string {
  return language.split(/[-_]/)[0].toLowerCase();
}
