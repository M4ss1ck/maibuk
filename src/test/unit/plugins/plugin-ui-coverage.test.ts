// @vitest-environment node
//
// The coverage gate: every public component in the UI kit table has a
// keyboard (or semantics) test rendered from a real remote tree (#438). The
// gate scans the test suite for `@ui:<tag>` titles in files that drive
// `renderRemoteUi`, not a shared registry, because Vitest isolates each file;
// a table row without such a tag fails here. Requiring the rendering harness
// is what keeps the gate from being satisfied by a unit test that never mounts
// the remote renderer.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_UI_TABLE } from "@/plugin-sdk/ui-table";

const TEST_ROOT = join(process.cwd(), "src/test");
const RENDERING_HARNESS = "renderRemoteUi";

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return testFiles(path);
    return /\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

const TAG = /@ui:([\w-]+)/g;

/** Tag → the test files that carry it in a title. */
function coveredTags(): Map<string, string[]> {
  const covered = new Map<string, string[]>();
  for (const file of testFiles(TEST_ROOT)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(TAG)) {
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

describe("UI kit coverage gate", () => {
  const covered = coveredTags();
  const rendering = renderingFiles();
  const tags = new Set(PLUGIN_UI_TABLE.map((element) => element.tag));

  it("fails when a table component has no test rendered from a remote tree", () => {
    const missing = [...tags].filter(
      (tag) => !(covered.get(tag) ?? []).some((file) => rendering.has(file))
    );
    expect(
      missing,
      `Add a test titled with @ui:<tag> in a file that renders a remote tree for: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("fails when a test claims a tag the table does not define", () => {
    const unknown = [...covered.keys()].filter((tag) => !tags.has(tag));
    expect(unknown).toEqual([]);
  });
});
