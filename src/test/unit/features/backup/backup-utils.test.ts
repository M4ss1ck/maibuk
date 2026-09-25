import { describe, expect, it } from "vitest";
import { formatBackupDate } from "@/features/backup/utils";

// Built from local components so the expectation holds in any test timezone.
const afternoon = new Date(2026, 2, 5, 14, 30, 7);
const morning = new Date(2026, 11, 24, 9, 5, 3);

describe("formatBackupDate()", () => {
  it("writes English as MM/DD/YYYY with 12-hour time and seconds", () => {
    expect(formatBackupDate(afternoon, "en")).toBe("03/05/2026, 02:30:07 PM");
    expect(formatBackupDate(morning, "en")).toBe("12/24/2026, 09:05:03 AM");
  });

  it("writes Spanish as DD/MM/YYYY with 12-hour time and seconds", () => {
    // Intl separates "p. m." with narrow no-break spaces; normalize for readability.
    const normalize = (value: string) => value.replace(/[  ]/g, " ");
    expect(normalize(formatBackupDate(afternoon, "es"))).toBe("05/03/2026, 02:30:07 p. m.");
    expect(normalize(formatBackupDate(morning, "es"))).toBe("24/12/2026, 09:05:03 a. m.");
  });

  it("follows the language it is given, not the runtime default", () => {
    expect(formatBackupDate(afternoon, "es")).not.toBe(formatBackupDate(afternoon, "en"));
  });
});
