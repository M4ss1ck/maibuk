import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  releaseNotesFile,
  compareReleaseNotesParity,
} from "@/features/releases/release-notes-parity";
import { parseChangelog } from "@/features/releases/release-notes";

const SOURCE = [
  "# Changelog",
  "",
  "## [1.2.0] - 2026-01-02",
  "",
  "### Added",
  "- First thing",
  "- Second thing",
  "",
  "### Fixed",
  "- Fix one",
  "",
  "## [1.1.0] - 2026-01-01",
  "",
  "### Changed",
  "- Older change",
].join("\n");

const ENGLISH = parseChangelog(SOURCE);

function compare(translated: string, locale = "es"): string[] {
  return compareReleaseNotesParity(ENGLISH, parseChangelog(translated), locale);
}

describe("compareReleaseNotesParity()", () => {
  it("is silent for a translation that matches one to one", () => {
    expect(compare(SOURCE)).toEqual([]);
  });

  it("reports a dropped item with the locale, the Release, and the section", () => {
    expect(compare(SOURCE.replace("- First thing\n", ""))).toEqual([
      'CHANGELOG.es.md Release 1.2.0 section "added" has 1 item; English has 2 items',
    ]);
  });

  it("reports an extra Release", () => {
    const extra = `${SOURCE}\n\n## [9.9.9] - 2026-02-01\n\n### Added\n- Extra\n`;
    expect(compare(extra)).toEqual([
      "CHANGELOG.es.md adds Release 9.9.9, which English does not list",
    ]);
  });

  it("reports a missing Release with its date", () => {
    const missing = SOURCE.replace(
      "\n\n## [1.1.0] - 2026-01-01\n\n### Changed\n- Older change",
      ""
    );
    expect(compare(missing)).toEqual(["CHANGELOG.es.md is missing Release 1.1.0 (2026-01-01)"]);
  });

  it("reports swapped sections in the same Release", () => {
    const swapped = [
      "# Changelog",
      "",
      "## [1.2.0] - 2026-01-02",
      "",
      "### Fixed",
      "- Fix one",
      "",
      "### Added",
      "- First thing",
      "- Second thing",
      "",
      "## [1.1.0] - 2026-01-01",
      "",
      "### Changed",
      "- Older change",
    ].join("\n");
    expect(compare(swapped)).toEqual([
      "CHANGELOG.es.md Release 1.2.0 has sections fixed, added; English has added, fixed",
    ]);
  });

  it("reports a wrong date", () => {
    expect(compare(SOURCE.replace("2026-01-02", "2026-01-03"))).toEqual([
      "CHANGELOG.es.md Release 1.2.0 has date 2026-01-03; English has 2026-01-02",
    ]);
  });

  it("reports a line outside the grammar with its number", () => {
    expect(compare(SOURCE.replace("- Older change", "- Older change\nstray prose"))).toEqual([
      "CHANGELOG.es.md line 16 does not follow the Release Notes grammar: stray prose",
    ]);
  });

  it("names the English file for English and the localized one otherwise", () => {
    expect(releaseNotesFile("en")).toBe("CHANGELOG.md");
    expect(releaseNotesFile("es")).toBe("CHANGELOG.es.md");
  });
});

describe("the shipped changelogs", () => {
  const root = process.cwd();
  const english = parseChangelog(readFileSync(`${root}/CHANGELOG.md`, "utf8"));
  const locales = readdirSync(`${root}/src/locales`)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .sort();

  it("discovers the app languages from the locale files", () => {
    expect(locales).toContain("en");
    expect(locales.length).toBeGreaterThan(1);
  });

  it("has a translated changelog per app language, in parity with the English one", () => {
    const differences: string[] = [];
    for (const locale of locales) {
      if (locale === "en") continue;
      const file = releaseNotesFile(locale);
      let source: string;
      try {
        source = readFileSync(`${root}/${file}`, "utf8");
      } catch {
        differences.push(`${file} is missing; every app language needs its own changelog`);
        continue;
      }
      differences.push(...compareReleaseNotesParity(english, parseChangelog(source), locale));
    }
    expect(differences).toEqual([]);
  });
});
