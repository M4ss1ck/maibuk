// Resets the Tauri install-format marker in a compiled maibuk binary to UNK, so
// the binary reports an unknown bundle type (ADR 0037: the Arch package must
// never Update in place; pacman owns its files).
//   node scripts/clear-bundle-type.mjs <binary>
// Tauri embeds the bundle type as six `__TAURI_BUNDLE_TYPE_VAR_<SUFFIX>` strings:
// the first five are the comparison constants DEB, RPM, APP, MSI, NSS (in that
// order) and the sixth is the value the bundler overwrites in place with DEB,
// RPM or APP. Only the sixth is rewritten. Anything other than exactly that
// layout throws, because a guessed patch would hide a Tauri change.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const PREFIX = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_", "latin1");
const SUFFIX_LENGTH = 3;
const CONSTANT_SUFFIXES = ["DEB", "RPM", "APP", "MSI", "NSS"];
const UNKNOWN_SUFFIX = "UNK";
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
 * untouched, unless the layout is exactly six markers with the first five
 * suffixes DEB,RPM,APP,MSI,NSS in order.
 * @param {Buffer} buffer
 * @returns {{ changed: boolean; was: string }}
 */
export function clearBundleType(buffer) {
  const offsets = markerOffsets(buffer);
  const suffixes = offsets.map((at) =>
    buffer.subarray(at + PREFIX.length, at + PREFIX.length + SUFFIX_LENGTH).toString("latin1")
  );
  const found = suffixes.map((suffix) => `__TAURI_BUNDLE_TYPE_VAR_${suffix}`);

  if (offsets.length !== 6) {
    throw new Error(
      `expected 6 bundle type markers (__TAURI_BUNDLE_TYPE_VAR_<SUFFIX>), found ${offsets.length}`
    );
  }
  suffixes.forEach((suffix, index) => {
    if (!SUFFIX_PATTERN.test(suffix)) {
      throw new Error(`marker ${index + 1} has no 3-letter suffix: ${found[index]}`);
    }
  });
  const firstFive = suffixes.slice(0, 5);
  if (firstFive.some((suffix, index) => suffix !== CONSTANT_SUFFIXES[index])) {
    throw new Error(
      `expected the first five markers to be ${CONSTANT_SUFFIXES.join(",")} in order, found ${firstFive.join(",")}`
    );
  }

  const was = suffixes[5];
  if (was === UNKNOWN_SUFFIX) {
    return { changed: false, was };
  }
  buffer.write(UNKNOWN_SUFFIX, offsets[5] + PREFIX.length, "latin1");
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
