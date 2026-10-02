// Release Notes are Keep a Changelog markdown: the bundled CHANGELOG.md, and
// each published Release's body on GitHub (the same section, without its
// heading). The grammar is small and fixed, so it is parsed into data and
// rendered as text; nothing here ever becomes HTML.

export const SECTION_KINDS = [
  "added",
  "changed",
  "deprecated",
  "removed",
  "fixed",
  "security",
  // scripts/lib/changelog.sh files commits it cannot classify here.
  "other",
] as const;

export type SectionKind = (typeof SECTION_KINDS)[number];

export type InlineSegment =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export interface ReleaseSection {
  /** null: notes that did not follow the grammar, shown as plain items. */
  kind: SectionKind | null;
  items: InlineSegment[][];
}

export interface ReleaseNotes {
  /** Without the leading "v": "0.10.1". */
  number: string;
  /** ISO date (YYYY-MM-DD), or null when the source has none. */
  date: string | null;
  sections: ReleaseSection[];
  /** The Release's page on GitHub, known only for fetched Releases. */
  url?: string;
}

export interface ParsedChangelog {
  releases: ReleaseNotes[];
  /** Lines the grammar did not accept, 1-based. Empty for a well-formed file. */
  problems: { line: number; text: string }[];
}

const RELEASE_HEADING = /^## \[v?(\d+(?:\.\d+)*)\](?: - (\d{4}-\d{2}-\d{2}))?\s*$/;
const SECTION_HEADING = /^### (\w+)\s*$/;
const BULLET = /^[-*] (.*)$/;
const CONTINUATION = /^\s{2,}(\S.*)$/;
const INLINE = /`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

export function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ kind: "text", text: text.slice(last, index) });
    if (match[1] !== undefined) {
      segments.push({ kind: "code", text: match[1] });
    } else {
      // Only https links leave the app; anything else reads as its text.
      const href = match[3];
      segments.push(
        href.startsWith("https://")
          ? { kind: "link", text: match[2], href }
          : { kind: "text", text: match[2] }
      );
    }
    last = index + match[0].length;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
}

function sectionKind(heading: string): SectionKind | undefined {
  const kind = heading.toLowerCase();
  return (SECTION_KINDS as readonly string[]).includes(kind) ? (kind as SectionKind) : undefined;
}

interface SectionsResult {
  sections: ReleaseSection[];
  problems: { line: number; text: string }[];
}

/**
 * Parses the `### Kind` / `- item` body of one Release. `firstLine` is the
 * 1-based line number of `lines[0]`, so problems point into the source file.
 */
function parseSections(lines: string[], firstLine: number): SectionsResult {
  const sections: ReleaseSection[] = [];
  const problems: { line: number; text: string }[] = [];
  let section: ReleaseSection | null = null;
  // Raw item text, joined with continuation lines before inline parsing.
  let pending: string[] = [];

  const flushItems = () => {
    if (section) for (const raw of pending) section.items.push(parseInline(raw));
    pending = [];
  };

  lines.forEach((line, offset) => {
    const lineNumber = firstLine + offset;
    if (line.trim() === "") return;
    const heading = SECTION_HEADING.exec(line);
    if (heading) {
      flushItems();
      const kind = sectionKind(heading[1]);
      if (kind === undefined) {
        problems.push({ line: lineNumber, text: line });
        section = null;
        return;
      }
      section = { kind, items: [] };
      sections.push(section);
      return;
    }
    const bullet = BULLET.exec(line);
    if (bullet && section) {
      pending.push(bullet[1].trim());
      return;
    }
    const continuation = CONTINUATION.exec(line);
    if (continuation && pending.length > 0) {
      pending[pending.length - 1] += ` ${continuation[1].trim()}`;
      return;
    }
    problems.push({ line: lineNumber, text: line });
  });
  flushItems();

  return { sections: sections.filter((s) => s.items.length > 0), problems };
}

/**
 * The whole CHANGELOG.md. Text before the first Release (the title and
 * preamble) and a closing `>` note are not Release Notes and are skipped;
 * every other line must fit the grammar or it is reported as a problem.
 */
export function parseChangelog(markdown: string): ParsedChangelog {
  const lines = markdown.split(/\r?\n/);
  const releases: ReleaseNotes[] = [];
  const problems: { line: number; text: string }[] = [];

  const starts: number[] = [];
  lines.forEach((line, index) => {
    if (line.startsWith("## ")) starts.push(index);
  });

  starts.forEach((start, position) => {
    const end = position + 1 < starts.length ? starts[position + 1] : lines.length;
    const heading = RELEASE_HEADING.exec(lines[start]);
    if (!heading) {
      problems.push({ line: start + 1, text: lines[start] });
      return;
    }
    const body = lines.slice(start + 1, end);
    // The closing note ("Older releases are listed on…") ends the file.
    const isLast = position === starts.length - 1;
    const kept = isLast ? body.filter((line) => !line.startsWith(">")) : body;
    const result = parseSections(kept, start + 2);
    problems.push(...result.problems);
    releases.push({ number: heading[1], date: heading[2] ?? null, sections: result.sections });
  });

  return { releases, problems };
}

/**
 * One published Release's body. A body that does not follow the grammar (a
 * Release edited by hand on GitHub) is still shown: its non-empty lines become
 * plain items, so a Release is never hidden for its formatting.
 */
export function parseReleaseBody(body: string): ReleaseSection[] {
  const lines = body.split(/\r?\n/);
  const { sections, problems } = parseSections(lines, 1);
  if (problems.length === 0 && sections.length > 0) return sections;

  const items = lines
    .map((line) =>
      line
        .trim()
        .replace(/^#+\s*/, "")
        .replace(/^[-*]\s+/, "")
    )
    .filter((line) => line !== "")
    .map(parseInline);
  return items.length > 0 ? [{ kind: null, items }] : [];
}
