// @vitest-environment node
//
// The coverage gate: every public component in the UI kit table has a test
// rendered from a real remote tree (#438). An interactive row must have a
// keyboard test (`@ui-kbd:<tag>`) driven by key presses; a non-interactive row
// keeps a semantics test (`@ui:<tag>`). The gate scans the test suite for
// those titles in files that drive `renderRemoteUi`, not a shared registry,
// because Vitest isolates each file; a table row without the right tag fails
// here. Requiring the rendering harness is what keeps the gate from being
// satisfied by a unit test that never mounts the remote renderer.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_UI_TABLE, type PluginUiElement } from "@/plugin-sdk/ui-table";

const TEST_ROOT = join(process.cwd(), "src/test");
const RENDERING_HARNESS = "renderRemoteUi";

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return testFiles(path);
    return /\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

const UI_TAG = /@ui:([\w-]+)/g;
const KBD_TAG = /@ui-kbd:([\w-]+)/g;

/** Tag → the test files that carry it in a title, for one tag prefix. */
function coveredTags(tag: RegExp): Map<string, string[]> {
  const covered = new Map<string, string[]>();
  for (const file of testFiles(TEST_ROOT)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(tag)) {
      const list = covered.get(match[1]) ?? [];
      list.push(relative(process.cwd(), file));
      covered.set(match[1], list);
    }
  }
  return covered;
}

/** Files that mount the remote renderer, so a tag in them is a rendered test. */
function renderingFiles(): Set<string> {
  return new Set(
    testFiles(TEST_ROOT)
      .filter((file) => readFileSync(file, "utf8").includes(RENDERING_HARNESS))
      .map((file) => relative(process.cwd(), file))
  );
}

/** Tags from the table whose required test is missing from a rendering file. */
function missingCoverage(
  table: readonly Pick<PluginUiElement, "tag" | "interactive">[],
  uiTags: Map<string, string[]>,
  kbdTags: Map<string, string[]>,
  rendering: Set<string>
): { ui: string[]; kbd: string[] } {
  const inRendering = (map: Map<string, string[]>, tag: string) =>
    (map.get(tag) ?? []).some((file) => rendering.has(file));
  return {
    ui: table
      .filter((element) => !element.interactive && !inRendering(uiTags, element.tag))
      .map((element) => element.tag),
    kbd: table
      .filter((element) => element.interactive && !inRendering(kbdTags, element.tag))
      .map((element) => element.tag),
  };
}

describe("UI kit coverage gate", () => {
  const uiTags = coveredTags(UI_TAG);
  const kbdTags = coveredTags(KBD_TAG);
  const rendering = renderingFiles();
  const tags = new Set(PLUGIN_UI_TABLE.map((element) => element.tag));

  it("fails when a non-interactive component has no rendered semantics test", () => {
    const missing = missingCoverage(PLUGIN_UI_TABLE, uiTags, kbdTags, rendering).ui;
    expect(
      missing,
      `Add a test titled with @ui:<tag> in a file that renders a remote tree for: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("fails when an interactive component has no keyboard test", () => {
    const missing = missingCoverage(PLUGIN_UI_TABLE, uiTags, kbdTags, rendering).kbd;
    expect(
      missing,
      `Add a test titled with @ui-kbd:<tag> driven by key presses in a file that renders a remote tree for: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("fails when a test claims a tag the table does not define", () => {
    const unknown = [...new Set([...uiTags.keys(), ...kbdTags.keys()])].filter(
      (tag) => !tags.has(tag)
    );
    expect(unknown).toEqual([]);
  });

  it("reports a missing keyboard test as a failure (gate self-test)", () => {
    const table = [{ tag: "maibuk-fake", interactive: true }];
    expect(missingCoverage(table, new Map(), new Map(), new Set()).kbd).toEqual(["maibuk-fake"]);
  });

  it("reports a missing semantics test as a failure (gate self-test)", () => {
    const table = [{ tag: "maibuk-fake", interactive: false }];
    expect(missingCoverage(table, new Map(), new Map(), new Set()).ui).toEqual(["maibuk-fake"]);
  });
});
