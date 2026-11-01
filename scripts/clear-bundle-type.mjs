// Resets the Tauri install-format marker in a compiled maibuk binary to UNK, so
// the binary reports an unknown bundle type (ADR 0037: the Arch package must
// never Update in place; pacman owns its files).
//   node scripts/clear-bundle-type.mjs <binary>
// Tauri's source holds six `__TAURI_BUNDLE_TYPE_VAR_<SUFFIX>` strings: five
// comparison constants DEB, RPM, APP, MSI, NSS and the value the bundler
// overwrites in place (its UNK placeholder becomes DEB, RPM or APP). The binary
// carries one of two layouts, depending on the compiler:
//   - six markers, the five constants first, then the value. The constants'
//     order is the linker's: DEB,RPM,APP,MSI,NSS by default, APP,MSI,NSS,DEB,RPM
//     under the release profile's fat LTO and single codegen unit;
//   - one marker, the value alone, when the compiler inlines the constant
//     comparisons (rustc 1.99 does).
// Only the value is rewritten. Any other layout throws, because a guessed patch
// would hide a Tauri change.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const PREFIX = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_", "latin1");
const SUFFIX_LENGTH = 3;
const CONSTANT_SUFFIXES = ["DEB", "RPM", "APP", "MSI", "NSS"];
const UNKNOWN_SUFFIX = "UNK";
const LAYOUT_SIZES = [1, 6];
const SUFFIX_PATTERN = /^[A-Z]{3}$/;

/** Byte offsets of every marker prefix, in file order. */
function markerOffsets(buffer) {
  const offsets = [];
  for (let at = buffer.indexOf(PREFIX); at !== -1; at = buffer.indexOf(PREFIX, at + 1)) {
    offsets.push(at);
  }
  return offsets;
}

/**
 * Rewrites the bundle-type marker in `buffer` to UNK, in place.
 * Returns `changed: false` when it already reads UNK. Throws, leaving `buffer`
 * untouched, unless the layout is six markers whose first five suffixes are
 * DEB, RPM, APP, MSI and NSS in any order, or one marker holding a known bundle
 * type.
 * @param {Buffer} buffer
 * @returns {{ changed: boolean; was: string }}
 */
export function clearBundleType(buffer) {
  const offsets = markerOffsets(buffer);
  const suffixes = offsets.map((at) =>
    buffer.subarray(at + PREFIX.length, at + PREFIX.length + SUFFIX_LENGTH).toString("latin1")
  );
  const found = suffixes.map((suffix) => `__TAURI_BUNDLE_TYPE_VAR_${suffix}`);

  if (!LAYOUT_SIZES.includes(offsets.length)) {
    throw new Error(
      `expected 1 or 6 bundle type markers (__TAURI_BUNDLE_TYPE_VAR_<SUFFIX>), found ${offsets.length}`
    );
  }
  suffixes.forEach((suffix, index) => {
    if (!SUFFIX_PATTERN.test(suffix)) {
      throw new Error(`marker ${index + 1} has no 3-letter suffix: ${found[index]}`);
    }
  });
  if (offsets.length === 6) {
    const firstFive = suffixes.slice(0, 5);
    if (CONSTANT_SUFFIXES.some((suffix) => !firstFive.includes(suffix))) {
      throw new Error(
        `expected the first five markers to be ${CONSTANT_SUFFIXES.join(",")} in any order, found ${firstFive.join(",")}`
      );
    }
  } else if (![...CONSTANT_SUFFIXES, UNKNOWN_SUFFIX].includes(suffixes[0])) {
    throw new Error(`lone marker has an unknown bundle type: ${suffixes[0]}`);
  }

  const value = offsets.length - 1;
  const was = suffixes[value];
  if (was === UNKNOWN_SUFFIX) {
    return { changed: false, was };
  }
  buffer.write(UNKNOWN_SUFFIX, offsets[value] + PREFIX.length, "latin1");
  return { changed: true, was };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node scripts/clear-bundle-type.mjs <binary>");
    process.exit(1);
  }
  try {
    const buffer = readFileSync(path);
    const { changed, was } = clearBundleType(buffer);
    if (changed) {
      writeFileSync(path, buffer);
      console.log(`bundle type marker: was ${was}, now ${UNKNOWN_SUFFIX}`);
    } else {
      console.log("bundle type marker: already UNK");
    }
  } catch (error) {
    console.error(`clear-bundle-type: ${path}: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
