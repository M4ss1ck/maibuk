// path-data-parser@0.1.0 tokenizes with the legacy `RegExp.$1` static, which
// Android's QuickJS engine does not implement, so a Maps template built from a
// rough.js path threw "cannot read property length of undefined". The patch in
// `patches/` rewrites `tokenize()` to read the `match` array; this proves the
// parser returns the same segments while `RegExp.$1` is unavailable.
import { parsePath } from "path-data-parser";
import { afterEach, describe, expect, it } from "vitest";

const PATH = "M10 20 L30.5 -4 C1 2 3 4 5 6 Z";

const EXPECTED = [
  { key: "M", data: [10, 20] },
  { key: "L", data: [30.5, -4] },
  { key: "C", data: [1, 2, 3, 4, 5, 6] },
  { key: "Z", data: [] },
];

const original = Object.getOwnPropertyDescriptor(RegExp, "$1");

/** Makes the legacy static read as `undefined`, the way QuickJS leaves it. */
function hideLegacyRegExpStatics(): void {
  Object.defineProperty(RegExp, "$1", {
    get() {
      return undefined;
    },
    configurable: true,
  });
}

afterEach(() => {
  if (original !== undefined) Object.defineProperty(RegExp, "$1", original);
  else Reflect.deleteProperty(RegExp, "$1");
});

describe("path-data-parser without legacy RegExp.$1", () => {
  it("parses a path to the same segments as the engine that has RegExp.$1", () => {
    const withLegacyStatics = parsePath(PATH);
    expect(withLegacyStatics).toEqual(EXPECTED);

    hideLegacyRegExpStatics();
    expect(parsePath(PATH)).toEqual(withLegacyStatics);
  });
});
