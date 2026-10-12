/**
 * Formats a Plugin's stored data size for its Settings row (#443). Binary
 * units labelled MB/KB, matching the 50 MB warning's 1024-based threshold; the
 * number is formatted for the author's locale, so Spanish reads "4,5 MB". The
 * locale is a parameter (the caller passes `i18n.language`) to keep this pure.
 */
export function formatPluginDataSize(bytes: number, locale: string): string {
  const format = (value: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  if (bytes >= 1024 * 1024) {
    return `${format(bytes / (1024 * 1024))} MB`;
  }
  if (bytes >= 1024) {
    return `${format(bytes / 1024)} KB`;
  }
  return `${format(Math.max(0, Math.round(bytes)))} B`;
}
