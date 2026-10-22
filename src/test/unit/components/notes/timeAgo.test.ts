import { describe, expect, it } from "vitest";
import { noteDateLabel, noteFullDate } from "@/components/notes/timeAgo";

// Intl can put a narrow no-break space before the AM/PM marker; compare on plain spaces.
const normalize = (value: string) => value.replace(/\s/g, " ");

const seconds = (date: Date) => date.getTime() / 1000;

describe("noteDateLabel()", () => {
  it("shows the time of day for a Note edited earlier today", () => {
    const now = new Date(2026, 9, 22, 15, 0);
    const label = normalize(noteDateLabel(seconds(new Date(2026, 9, 22, 14, 32)), "en", now));

    expect(label).toContain("32");
    expect(label).toMatch(/PM/);
  });

  it("keeps a 12-hour clock in Spanish", () => {
    const now = new Date(2026, 9, 22, 15, 0);
    const label = normalize(noteDateLabel(seconds(new Date(2026, 9, 22, 14, 32)), "es", now));

    expect(label).toContain("32");
    expect(label).toMatch(/p\. m\.|a\. m\./i);
  });

  it("shows the short month and day for a Note edited on an earlier day", () => {
    const now = new Date(2026, 9, 22, 12, 0);
    const label = noteDateLabel(seconds(new Date(2026, 9, 21, 23, 59)), "en", now);

    expect(label).toBe("Oct 21");
  });

  it("counts midnight today as today", () => {
    const now = new Date(2026, 9, 22, 12, 0);
    const label = normalize(noteDateLabel(seconds(new Date(2026, 9, 22, 0, 0)), "en", now));

    expect(label).toContain("12:00");
    expect(label).toMatch(/AM/);
  });

  it("does not count 23:59 yesterday as today", () => {
    const now = new Date(2026, 9, 22, 0, 5);
    const label = noteDateLabel(seconds(new Date(2026, 9, 21, 23, 59)), "en", now);

    expect(label).toBe("Oct 21");
  });
});

describe("noteFullDate()", () => {
  it("names the year, the full month and the time", () => {
    const label = normalize(noteFullDate(seconds(new Date(2026, 9, 22, 14, 32)), "en"));

    expect(label).toContain("2026");
    expect(label).toContain("October");
    expect(label).toContain("2:32");
    expect(label).toMatch(/PM/);
  });
});
