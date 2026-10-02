// @vitest-environment node
import { SourceMapGenerator } from "source-map-js";
import { describe, expect, it } from "vitest";
import { resolveLongFrameSources } from "@/test/support/frames/attribution";
import type { LongAnimationFrame } from "@/test/support/frames/frame-report";

// A two-line "bundle". Line 1 is "/* bundle 1 */\n", 15 characters, so line 2
// starts at char 15 (a dependency's code) and `function p` at char 23, line 2
// column 8 (the app's).
const BUNDLE = "/* bundle 1 */\nvar a=1;function p(){}";
const MAP = (() => {
  const generator = new SourceMapGenerator({ file: "index-abc.js" });
  generator.addMapping({
    generated: { line: 2, column: 0 },
    original: { line: 14, column: 0 },
    source:
      "../../node_modules/.pnpm/react-aria@3.50.0_react@19.2.3/node_modules/react-aria/dist/private/utils/chain.mjs",
  });
  generator.addMapping({
    generated: { line: 2, column: 8 },
    original: { line: 42, column: 2 },
    source: "../../src/components/command-palette/CommandPalette.tsx",
    name: "handleKeyDown",
  });
  return generator.toString();
})();

function frame(sourceURL: string, sourceCharPosition: number): LongAnimationFrame {
  return {
    startMs: 0,
    durationMs: 140,
    scripts: [
      {
        invoker: "DOMWindow.onkeydown",
        sourceURL,
        sourceFunctionName: "p",
        sourceCharPosition,
        durationMs: 138,
      },
    ],
  };
}

const files: Record<string, string> = {
  "assets/index-abc.js": BUNDLE,
  "assets/index-abc.js.map": MAP,
};
const read = (path: string) => files[path] ?? null;

describe("resolveLongFrameSources()", () => {
  it("names the original file, line, and function behind a minified script", () => {
    const [resolved] = resolveLongFrameSources(
      [frame("http://127.0.0.1:4173/assets/index-abc.js", 23)],
      read
    );
    expect(resolved.scripts[0].source).toBe(
      "src/components/command-palette/CommandPalette.tsx:42 (handleKeyDown)"
    );
  });

  it("names a dependency by its package path, not pnpm's store path", () => {
    const [resolved] = resolveLongFrameSources(
      [frame("http://127.0.0.1:4173/assets/index-abc.js", 15)],
      read
    );
    expect(resolved.scripts[0].source).toBe("react-aria/dist/private/utils/chain.mjs:14");
  });

  it("leaves a script alone when its bundle has no source map or no position", () => {
    const noMap = resolveLongFrameSources(
      [frame("http://127.0.0.1:4173/assets/other.js", 23)],
      read
    );
    expect(noMap[0].scripts[0].source).toBeUndefined();
    const noPosition = resolveLongFrameSources(
      [frame("http://127.0.0.1:4173/assets/index-abc.js", -1)],
      read
    );
    expect(noPosition[0].scripts[0].source).toBeUndefined();
    const notAUrl = resolveLongFrameSources([frame("", 23)], read);
    expect(notAUrl[0].scripts[0].source).toBeUndefined();
  });
});
