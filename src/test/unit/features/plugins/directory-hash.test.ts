import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PluginDirectoryHashError,
  hashPluginDirectory,
  pluginFileDigests,
} from "@/features/plugins/directory-hash";
import { readFolderFiles } from "@/test/support/plugin-fixtures";

const FIXTURE_DIR = resolve(__dirname, "../../../fixtures/plugins/hash-fixture");

interface ExpectedFixture {
  hash: string;
  files: Record<string, string>;
}

interface ExpectedNewlineFixture {
  refusal: { code: string; message: string };
  files: string[];
}

const expected: ExpectedFixture = JSON.parse(
  readFileSync(resolve(FIXTURE_DIR, "../hash-fixture.expected.json"), "utf8")
);
const expectedNewline: ExpectedNewlineFixture = JSON.parse(
  readFileSync(resolve(FIXTURE_DIR, "../hash-fixture-newline.expected.json"), "utf8")
);

describe("hashPluginDirectory()", () => {
  it("matches the shared h1: fixture the Rust implementation must also match", async () => {
    await expect(hashPluginDirectory(readFolderFiles(FIXTURE_DIR))).resolves.toBe(expected.hash);
  });

  it("reports every file's digest, matching the fixture's per-file list", async () => {
    const digests = await pluginFileDigests(readFolderFiles(FIXTURE_DIR));
    expect(Object.fromEntries(digests)).toEqual(expected.files);
  });

  it("hashes an empty folder to the h1: of the empty summary", async () => {
    // Independent known value: base64(SHA-256("")) with the Go dirhash prefix.
    await expect(hashPluginDirectory([])).resolves.toBe(
      "h1:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="
    );
  });

  it("is independent of the order the folder was listed in", async () => {
    const files = readFolderFiles(FIXTURE_DIR);
    const shuffled = [...files].reverse();
    await expect(hashPluginDirectory(shuffled)).resolves.toBe(expected.hash);
  });

  it("changes when one file's bytes change", async () => {
    const files = readFolderFiles(FIXTURE_DIR).map((file) =>
      file.path === "index.js" ? { ...file, bytes: new TextEncoder().encode("changed") } : file
    );
    await expect(hashPluginDirectory(files)).resolves.not.toBe(expected.hash);
  });

  it("refuses a path with a newline, as Go's dirhash.Hash1 does", async () => {
    // Without this refusal, one file named `data/a\n<digest>  b` would write
    // two summary lines and hash exactly like two separate paths; the shared
    // `hash-fixture-newline` contract makes the Rust adapter (#435) refuse the
    // same folder with the same reason.
    const files = expectedNewline.files.map((path) => ({
      path,
      bytes: new TextEncoder().encode(`contents of ${path}`),
    }));
    const error = await hashPluginDirectory(files).then(
      () => null,
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(PluginDirectoryHashError);
    const refusal = error as PluginDirectoryHashError;
    expect(refusal.code).toBe(expectedNewline.refusal.code);
    expect(refusal.message).toBe(expectedNewline.refusal.message);
    expect(refusal.path).toBe("data/a\nb.txt");
  });
});
