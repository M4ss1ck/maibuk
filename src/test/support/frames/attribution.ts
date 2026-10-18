// Long animation frame attribution, resolved to source (issue #372). The
// engine names a script by its bundle URL, its minified function name, and
// the character where it starts; with the build's source map that becomes the
// original file, line, and function a maintainer can open.

import { SourceMapConsumer } from "source-map-js";
import type {
  InputSample,
  LongAnimationFrame,
} from "@/test/support/frames/frame-report";

/** Reads a file of the served build by its path (`assets/index-abc.js`), or null. */
export type BuildReader = (path: string) => string | null;

function buildPath(sourceURL: string): string | null {
  try {
    return new URL(sourceURL).pathname.replace(/^\/+/, "");
  } catch {
    return null;
  }
}

function lineAndColumn(text: string, charPosition: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = text.indexOf("\n"); i !== -1 && i < charPosition; i = text.indexOf("\n", i + 1)) {
    line++;
    lineStart = i + 1;
  }
  return { line, column: charPosition - lineStart };
}

/** Adds `source` ("src/x.tsx:42 (name)") to every script the build's source maps cover. */
export function resolveLongFrameSources(
  frames: LongAnimationFrame[],
  read: BuildReader
): LongAnimationFrame[] {
  const consumers = new Map<string, { bundle: string; map: SourceMapConsumer } | null>();
  const load = (path: string) => {
    if (!consumers.has(path)) {
      const bundle = read(path);
      const map = bundle === null ? null : read(`${path}.map`);
      consumers.set(
        path,
        bundle !== null && map !== null ? { bundle, map: new SourceMapConsumer(JSON.parse(map)) } : null
      );
    }
    return consumers.get(path) ?? null;
  };
  return frames.map((frame) => ({
    ...frame,
    scripts: frame.scripts.map((script) => {
      const path = buildPath(script.sourceURL);
      const at = script.sourceCharPosition ?? -1;
      const loaded = path && at >= 0 ? load(path) : null;
      if (!loaded) return script;
      const original = loaded.map.originalPositionFor({
        ...lineAndColumn(loaded.bundle, at),
        bias: SourceMapConsumer.LEAST_UPPER_BOUND,
      });
      if (!original.source) return script;
      // A dependency reads from its package, not pnpm's store path.
      const relative = original.source.replace(/^(\.\.\/)+/, "").replace(/^\/+/, "");
      const file = relative.includes("node_modules/")
        ? relative.slice(relative.lastIndexOf("node_modules/") + "node_modules/".length)
        : relative;
      const name = original.name ? ` (${original.name})` : "";
      return { ...script, source: `${file}:${original.line}${name}` };
    }),
  }));
}

/**
 * Names each long frame after the key press that preceded it: the latest
 * keystroke at or before the frame's start, labelled "ArrowDown #7" for the
 * seventh ArrowDown of the window. A frame with no earlier press keeps no label.
 */
export function attributeKeyPresses(
  frames: LongAnimationFrame[],
  inputs: InputSample[]
): LongAnimationFrame[] {
  const presses = inputs
    .filter((input): input is InputSample & { key: string } => typeof input.key === "string")
    .sort((a, b) => a.atMs - b.atMs);
  const seen = new Map<string, number>();
  const labelled = presses.map((press) => {
    const count = (seen.get(press.key) ?? 0) + 1;
    seen.set(press.key, count);
    return { atMs: press.atMs, label: `${press.key} #${count}` };
  });
  return frames.map((frame) => {
    let before: { atMs: number; label: string } | undefined;
    for (const press of labelled) {
      if (press.atMs > frame.startMs) break;
      before = press;
    }
    return before ? { ...frame, afterKeyPress: before.label } : frame;
  });
}
