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

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Formatters are cached per locale: a list renders one label per Note.
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(locale: string, kind: "time" | "day" | "full"): Intl.DateTimeFormat {
  const key = `${kind}:${locale}`;
  let cached = formatters.get(key);
  if (!cached) {
    const options: Intl.DateTimeFormatOptions =
      kind === "time"
        ? { hour: "numeric", minute: "2-digit", hour12: true }
        : kind === "day"
          ? { month: "short", day: "numeric" }
          : { dateStyle: "long", timeStyle: "short", hour12: true };
    cached = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, cached);
  }
  return cached;
}

// The date a Note shows in a list row: the time of day for a Note edited
// today, the short month and day otherwise.
export function noteDateLabel(unixSeconds: number, locale: string, now = new Date()): string {
  const date = new Date(unixSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return formatter(locale, sameLocalDay(date, now) ? "time" : "day").format(date);
}

// The full date behind a date label, for its tooltip and accessible description.
export function noteFullDate(unixSeconds: number, locale: string): string {
  const date = new Date(unixSeconds * 1000);
  return Number.isNaN(date.getTime()) ? "" : formatter(locale, "full").format(date);
}
