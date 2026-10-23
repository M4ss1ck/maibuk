// Every app language ships one changelog file, and each is a translation of
// the English one, one to one: same Releases in the same order, same section
// kinds in the same order, same number of items per section. This is the pure
// comparison the guard runs over the files in the repo; the parsed notes
// themselves never reach a reader through it.

import type {
  ParsedChangelog,
  ReleaseNotes,
  ReleaseSection,
} from "@/features/releases/release-notes";

/** The changelog file a locale ships: `CHANGELOG.md` for English. */
export function changelogFile(locale: string): string {
  return locale === "en" ? "CHANGELOG.md" : `CHANGELOG.${locale}.md`;
}

function dateText(release: ReleaseNotes): string {
  return release.date === null ? "no date" : release.date;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function sectionName(section: ReleaseSection): string {
  return section.kind ?? "plain";
}

/**
 * Each section named by kind and occurrence, so two `Added` blocks in one
 * Release still pair up in order instead of collapsing into one.
 */
function keyedSections(sections: ReleaseSection[]): { key: string; count: number }[] {
  const seen = new Map<string, number>();
  return sections.map((section) => {
    const kind = sectionName(section);
    const occurrence = seen.get(kind) ?? 0;
    seen.set(kind, occurrence + 1);
    return { key: `${kind}#${occurrence}`, count: section.items.length };
  });
}

function compareSections(
  file: string,
  release: string,
  english: ReleaseSection[],
  translated: ReleaseSection[],
  differences: string[]
): void {
  const englishKinds = english.map(sectionName);
  const translatedKinds = translated.map(sectionName);
  if (englishKinds.join(",") !== translatedKinds.join(",")) {
    differences.push(
      `${file} Release ${release} has sections ${translatedKinds.join(", ")}; English has ${englishKinds.join(", ")}`
    );
  }

  const translatedByKey = new Map(keyedSections(translated).map((s) => [s.key, s.count]));
  for (const section of keyedSections(english)) {
    const count = translatedByKey.get(section.key);
    if (count === undefined || count === section.count) continue;
    const kind = section.key.slice(0, section.key.lastIndexOf("#"));
    differences.push(
      `${file} Release ${release} section "${kind}" has ${plural(count, "item")}; English has ${plural(section.count, "item")}`
    );
  }
}

/**
 * What a translated changelog gets wrong against the English one, one message
 * per difference naming the file, the Release, and the mismatch. An empty
 * list is parity. `locale` is the changelog's language ("es"), so the message
 * names the file the author would have to open.
 */
export function compareChangelogParity(
  english: ParsedChangelog,
  translated: ParsedChangelog,
  locale: string
): string[] {
  const file = changelogFile(locale);
  const differences: string[] = [];

  for (const problem of translated.problems) {
    differences.push(
      `${file} line ${problem.line} does not follow the Release Notes grammar: ${problem.text}`
    );
  }

  const englishByNumber = new Map(english.releases.map((release) => [release.number, release]));
  const translatedByNumber = new Map(
    translated.releases.map((release) => [release.number, release])
  );

  for (const release of english.releases) {
    const translation = translatedByNumber.get(release.number);
    if (!translation) {
      differences.push(`${file} is missing Release ${release.number} (${dateText(release)})`);
      continue;
    }
    if (translation.date !== release.date) {
      differences.push(
        `${file} Release ${release.number} has date ${dateText(translation)}; English has ${dateText(release)}`
      );
    }
    compareSections(file, release.number, release.sections, translation.sections, differences);
  }

  for (const release of translated.releases) {
    if (englishByNumber.has(release.number)) continue;
    differences.push(`${file} adds Release ${release.number}, which English does not list`);
  }

  const sharedEnglish = english.releases
    .filter((release) => translatedByNumber.has(release.number))
    .map((release) => release.number);
  const sharedTranslated = translated.releases
    .filter((release) => englishByNumber.has(release.number))
    .map((release) => release.number);
  if (sharedEnglish.join(",") !== sharedTranslated.join(",")) {
    differences.push(
      `${file} lists Releases in the order ${sharedTranslated.join(", ")}; English lists ${sharedEnglish.join(", ")}`
    );
  }

  return differences;
}
