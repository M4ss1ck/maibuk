/**
 * Formats a Plugin's stored data size for its Settings row (#443). Binary
 * units labelled MB/KB, matching the 50 MB warning's 1024-based threshold; the
 * number is formatted for the author's locale, so Spanish reads "4,5 MB". The
 * unit labels are locale keys (`plugins.management.units.*`), passed in as a
 * translate function so this module stays pure and out of i18n (#443 review).
 */
export type PluginDataSizeTranslate = (key: string, options: { value: string }) => string;

export function formatPluginDataSize(
  bytes: number,
  locale: string,
  translate: PluginDataSizeTranslate
): string {
  const format = (value: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  if (bytes >= 1024 * 1024) {
    return translate("plugins.management.units.mb", { value: format(bytes / (1024 * 1024)) });
  }
  if (bytes >= 1024) {
    return translate("plugins.management.units.kb", { value: format(bytes / 1024) });
  }
  return translate("plugins.management.units.b", { value: format(Math.max(0, Math.round(bytes))) });
}
