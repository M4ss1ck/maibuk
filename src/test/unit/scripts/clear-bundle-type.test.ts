import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearBundleType } from "../../../../scripts/clear-bundle-type.mjs";

const SCRIPT = resolve(import.meta.dirname, "../../../../scripts/clear-bundle-type.mjs");
const PREFIX = "__TAURI_BUNDLE_TYPE_VAR_";
const CONSTANTS = ["DEB", "RPM", "APP", "MSI", "NSS"];

const marker = (suffix: string) => Buffer.from(`${PREFIX}${suffix}`, "latin1");
const filler = (length: number, seed: number) =>
  Buffer.from(Array.from({ length }, (_, i) => (i * 31 + seed) & 0xff));

/** A synthetic binary: filler, the five constants, filler, then the sixth marker, filler. */
function fakeBinary(sixth: string, constants: string[] = CONSTANTS): Buffer {
  return Buffer.concat([
    filler(64, 1),
    ...constants.flatMap((suffix, i) => [marker(suffix), filler(40 + i, i + 7)]),
    marker(sixth),
    filler(96, 3),
  ]);
}

/**
 * A synthetic binary with only the value marker: newer compilers (rustc 1.99 in
 * CI) inline the five comparison constants, so the full strings are gone.
 */
function singleMarkerBinary(value: string): Buffer {
  return Buffer.concat([filler(64, 1), marker(value), filler(96, 3)]);
}

/** Offset of the sixth marker's suffix bytes in a buffer built by fakeBinary. */
function sixthSuffixOffset(buffer: Buffer): number {
  const at = buffer.lastIndexOf(Buffer.from(PREFIX, "latin1"));
  return at + PREFIX.length;
}

describe("clearBundleType", () => {
  it.each(["DEB", "RPM", "APP"])("resets a patched %s binary to UNK", (was) => {
    const buffer = fakeBinary(was);
    const result = clearBundleType(buffer);

    expect(result).toEqual({ changed: true, was });
    expect(
      buffer.subarray(sixthSuffixOffset(buffer), sixthSuffixOffset(buffer) + 3).toString()
    ).toBe("UNK");
  });

  it("leaves every byte outside the sixth marker's suffix untouched", () => {
    const before = fakeBinary("RPM");
    const buffer = Buffer.from(before);
    clearBundleType(buffer);

    expect(buffer.length).toBe(before.length);
    const start = sixthSuffixOffset(before);
    expect(buffer.subarray(0, start)).toEqual(before.subarray(0, start));
    expect(buffer.subarray(start + 3)).toEqual(before.subarray(start + 3));
    expect(buffer.subarray(start, start + 3).toString()).toBe("UNK");
  });

  it("does not touch the five constant markers", () => {
    const before = fakeBinary("DEB");
    const buffer = Buffer.from(before);
    clearBundleType(buffer);

    for (const suffix of CONSTANTS) {
      expect(buffer.includes(marker(suffix))).toBe(true);
    }
    expect(buffer.equals(before)).toBe(false);
  });

  it("is a no-op when the sixth marker already reads UNK", () => {
    const before = fakeBinary("UNK");
    const buffer = Buffer.from(before);
    const result = clearBundleType(buffer);

    expect(result).toEqual({ changed: false, was: "UNK" });
    expect(buffer.equals(before)).toBe(true);
  });

  it("throws on zero markers and leaves the buffer untouched", () => {
    const buffer = filler(256, 9);
    const before = Buffer.from(buffer);
    expect(() => clearBundleType(buffer)).toThrow(/expected 1 or 6 bundle type markers.*found 0/);
    expect(buffer.equals(before)).toBe(true);
  });

  it("throws on two markers", () => {
    const buffer = Buffer.concat([singleMarkerBinary("DEB"), marker("UNK")]);
    expect(() => clearBundleType(buffer)).toThrow(/expected 1 or 6 bundle type markers.*found 2/);
  });

  it("throws on five markers", () => {
    const buffer = fakeBinary("DEB", CONSTANTS.slice(0, 4));
    expect(() => clearBundleType(buffer)).toThrow(/expected 1 or 6 bundle type markers.*found 5/);
  });

  it("throws on seven markers", () => {
    const buffer = Buffer.concat([fakeBinary("DEB"), marker("UNK")]);
    expect(() => clearBundleType(buffer)).toThrow(/expected 1 or 6 bundle type markers.*found 7/);
  });

  it("throws when the first five markers are out of order and does not patch", () => {
    const order = ["RPM", "DEB", "APP", "MSI", "NSS"];
    const buffer = fakeBinary("DEB", order);
    const before = Buffer.from(buffer);
    expect(() => clearBundleType(buffer)).toThrow(/first five markers to be DEB,RPM,APP,MSI,NSS/);
    expect(buffer.equals(before)).toBe(true);
  });

  it("throws when a marker has no 3-letter suffix", () => {
    const buffer = Buffer.concat([fakeBinary("DEB"), Buffer.from(`${PREFIX}X1`, "latin1")]);
    expect(() => clearBundleType(buffer)).toThrow(/expected 1 or 6 bundle type markers.*found 7/);

    const sixthBad = fakeBinary("D1B");
    expect(() => clearBundleType(sixthBad)).toThrow(/marker 6 has no 3-letter suffix/);
  });
});

describe("clearBundleType with the constants compiled away", () => {
  it.each(["DEB", "RPM", "APP", "MSI", "NSS"])("resets a lone %s marker to UNK", (was) => {
    const before = singleMarkerBinary(was);
    const buffer = Buffer.from(before);
    const result = clearBundleType(buffer);

    expect(result).toEqual({ changed: true, was });
    expect(buffer.equals(singleMarkerBinary("UNK"))).toBe(true);
  });

  it("is a no-op when the lone marker already reads UNK", () => {
    const before = singleMarkerBinary("UNK");
    const buffer = Buffer.from(before);

    expect(clearBundleType(buffer)).toEqual({ changed: false, was: "UNK" });
    expect(buffer.equals(before)).toBe(true);
  });

  it("throws on a lone marker with an unknown bundle type and does not patch", () => {
    const buffer = singleMarkerBinary("XYZ");
    const before = Buffer.from(buffer);
    expect(() => clearBundleType(buffer)).toThrow(/lone marker has an unknown bundle type: XYZ/);
    expect(buffer.equals(before)).toBe(true);
  });

  it("throws when the lone marker has no 3-letter suffix", () => {
    const buffer = Buffer.concat([filler(64, 1), Buffer.from(`${PREFIX}D1B`, "latin1")]);
    expect(() => clearBundleType(buffer)).toThrow(/marker 1 has no 3-letter suffix/);
  });
});

describe("clear-bundle-type CLI", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("rewrites the binary in place, keeps its mode, and exits 0", () => {
    dir = mkdtempSync(join(tmpdir(), "clear-bundle-type-"));
    const path = join(dir, "maibuk");
    writeFileSync(path, fakeBinary("APP"));
    chmodSync(path, 0o755);

    const run = spawnSync(process.execPath, [SCRIPT, path], { encoding: "utf8" });

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("bundle type marker: was APP, now UNK");
    expect(readFileSync(path).equals(fakeBinary("UNK"))).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o755);
  });

  it("exits non-zero with a message and leaves a file with no marker alone", () => {
    dir = mkdtempSync(join(tmpdir(), "clear-bundle-type-"));
    const path = join(dir, "maibuk");
    const original = filler(128, 5);
    writeFileSync(path, original);

    const run = spawnSync(process.execPath, [SCRIPT, path], { encoding: "utf8" });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("expected 1 or 6 bundle type markers");
    expect(readFileSync(path).equals(original)).toBe(true);
  });
});
