import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Settings screen had three section styles (cards, bare lists with
// uppercase titles, top-border separators). Every section now goes through
// SettingsSection; a hand-written <section> or section heading would bring
// a fourth style back.
const DIR = join(process.cwd(), "src/components/settings");

describe("Settings section sources", () => {
  const files = readdirSync(DIR).filter(
    (name) => name.endsWith(".tsx") && name !== "SettingsSection.tsx"
  );

  it("renders sections only through SettingsSection", () => {
    const offenders = files.filter((name) =>
      /<section[\s>]/.test(readFileSync(join(DIR, name), "utf8"))
    );
    expect(offenders).toEqual([]);
  });

  it("marks section headings only through SettingsSection", () => {
    const offenders = files.filter((name) =>
      /data-settings-section=["{]/.test(readFileSync(join(DIR, name), "utf8"))
    );
    expect(offenders).toEqual([]);
  });
});
