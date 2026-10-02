import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import githubReleases from "@/test/fixtures/releases/github-releases.json";
import {
  parseChangelog,
  parseInline,
  parseReleaseBody,
} from "@/features/releases/release-notes";
import { BUNDLED_RELEASES } from "@/features/releases/bundled";

describe("the shipped CHANGELOG.md", () => {
  const source = readFileSync(`${process.cwd()}/CHANGELOG.md`, "utf8");
  const parsed = parseChangelog(source);

  it("fits the Release Notes grammar, so every line reaches the app", () => {
    expect(parsed.problems).toEqual([]);
  });

  it("starts with the Release package.json declares", () => {
    const pkg = JSON.parse(readFileSync(`${process.cwd()}/package.json`, "utf8")) as {
      version: string;
    };
    expect(parsed.releases[0].number).toBe(pkg.version);
  });

  it("is what the build bundles", () => {
    expect(BUNDLED_RELEASES).toEqual(parsed.releases);
  });

  it("lists Releases newest first, each with notes", () => {
    for (const release of parsed.releases) expect(release.sections.length).toBeGreaterThan(0);
    const numbers = parsed.releases.map((r) => r.number);
    expect(numbers).toContain("0.4.12");
  });
});

describe("parseChangelog()", () => {
  const sample = [
    "# Changelog",
    "",
    "Intro with a [link](https://keepachangelog.com/).",
    "",
    "## [1.2.0] - 2026-01-02",
    "",
    "### Added",
    "- First thing",
    "- Second thing that wraps",
    "  onto a continuation line",
    "",
    "### Fixed",
    "- Fix `code` and [docs](https://example.com/docs)",
    "",
    "## [1.1.0] - 2026-01-01",
    "",
    "### Changed",
    "- Older change",
    "",
    "> Older releases are listed on GitHub.",
  ].join("\n");

  it("reads Releases, sections, items, and continuation lines", () => {
    const { releases, problems } = parseChangelog(sample);
    expect(problems).toEqual([]);
    expect(releases.map((r) => [r.number, r.date])).toEqual([
      ["1.2.0", "2026-01-02"],
      ["1.1.0", "2026-01-01"],
    ]);
    expect(releases[0].sections.map((s) => s.kind)).toEqual(["added", "fixed"]);
    expect(releases[0].sections[0].items[1]).toEqual([
      { kind: "text", text: "Second thing that wraps onto a continuation line" },
    ]);
    expect(releases[0].sections[1].items[0]).toEqual([
      { kind: "text", text: "Fix " },
      { kind: "code", text: "code" },
      { kind: "text", text: " and " },
      { kind: "link", text: "docs", href: "https://example.com/docs" },
    ]);
  });

  it("reports lines outside the grammar with their line number", () => {
    const { problems } = parseChangelog(
      ["## [1.0.0] - 2026-01-01", "### Added", "- ok", "stray prose", "### Improved", "- x"].join(
        "\n"
      )
    );
    expect(problems).toEqual([
      { line: 4, text: "stray prose" },
      { line: 5, text: "### Improved" },
      { line: 6, text: "- x" },
    ]);
  });

  it("reads the Other section the release script writes for unclassified commits", () => {
    const { releases, problems } = parseChangelog("## [1.0.0] - 2026-01-01\n### Other\n- x");
    expect(problems).toEqual([]);
    expect(releases[0].sections[0].kind).toBe("other");
  });

  it("reports a Release heading it cannot read", () => {
    const { releases, problems } = parseChangelog("## [Unreleased]\n### Added\n- x");
    expect(releases).toEqual([]);
    expect(problems[0]).toEqual({ line: 1, text: "## [Unreleased]" });
  });
});

describe("parseInline()", () => {
  it("never makes a link of a non-https target", () => {
    expect(parseInline("see [this](http://x.test) and [that](https://ok.test)")).toEqual([
      { kind: "text", text: "see " },
      { kind: "text", text: "this" },
      { kind: "text", text: " and " },
      { kind: "link", text: "that", href: "https://ok.test" },
    ]);
  });

  it("keeps markup-looking text as text", () => {
    expect(parseInline("<img src=x onerror=alert(1)>")).toEqual([
      { kind: "text", text: "<img src=x onerror=alert(1)>" },
    ]);
  });
});

describe("parseReleaseBody()", () => {
  it("reads a published Release's body", () => {
    const sections = parseReleaseBody(githubReleases[0].body);
    expect(sections.map((s) => s.kind)).toEqual(["added", "changed", "fixed"]);
    expect(sections[0].items[0]).toEqual([
      {
        kind: "text",
        text: "Searchable section outline in Settings and a compact section menu on narrow panels",
      },
    ]);
  });

  it("shows a hand-edited body as plain items instead of hiding it", () => {
    expect(parseReleaseBody("## Highlights\n\nFaster sync.\n- Fixed `x`\n")).toEqual([
      {
        kind: null,
        items: [
          [{ kind: "text", text: "Highlights" }],
          [{ kind: "text", text: "Faster sync." }],
          [
            { kind: "text", text: "Fixed " },
            { kind: "code", text: "x" },
          ],
        ],
      },
    ]);
  });

  it("returns no sections for an empty body", () => {
    expect(parseReleaseBody("\n  \n")).toEqual([]);
  });
});
