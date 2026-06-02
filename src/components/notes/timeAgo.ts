const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
  ["second", 1],
];

// Format a unix-seconds timestamp as a localized "x time ago" string.
export function timeAgo(unixSeconds: number, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const diffSeconds = Date.now() / 1000 - unixSeconds;
  for (const [unit, secondsInUnit] of UNITS) {
    if (Math.abs(diffSeconds) >= secondsInUnit || unit === "second") {
      return rtf.format(-Math.round(diffSeconds / secondsInUnit), unit);
    }
  }
  return "";
}
