/**
 * The i18next `t`, re-typed for Plugin management copy. Its keys interpolate
 * values (`{{name}}`, `{{folders}}`, `{{count}}`, `{{value}}`), which the
 * default `TFunction` typings do not model, so the Plugin Settings rows and the
 * Plugin section share one cast instead of each repeating it (#443 review).
 */
export type PluginTranslate = (key: string, options?: Record<string, unknown>) => string;

/** Returns `t` typed for Plugin management copy (see {@link PluginTranslate}). */
export function asPluginTranslate(t: unknown): PluginTranslate {
  return t as PluginTranslate;
}
