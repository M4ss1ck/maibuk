import type { TFunction } from "i18next";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
];

// Format a unix-seconds timestamp as a localized "x time ago" string.
// Seconds and minutes are shown without an amount ("seconds ago"); hours and up use Intl.
export function timeAgo(unixSeconds: number, locale: string, t: TFunction): string {
  const diffSeconds = Date.now() / 1000 - unixSeconds;
  const abs = Math.abs(diffSeconds);
  if (abs < 60) return t("notes.secondsAgo");
  if (abs < 60 * 60) return t("notes.minutesAgo");

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, secondsInUnit] of UNITS) {
    if (abs >= secondsInUnit) {
      return rtf.format(-Math.round(diffSeconds / secondsInUnit), unit);
    }
  }
  return "";
}
