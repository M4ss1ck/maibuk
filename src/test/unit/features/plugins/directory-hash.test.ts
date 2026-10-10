import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hashPluginDirectory, pluginFileDigests } from "@/features/plugins/directory-hash";
import { readFolderFiles } from "@/test/support/plugin-fixtures";

const FIXTURE_DIR = resolve(__dirname, "../../../fixtures/plugins/hash-fixture");

interface ExpectedFixture {
  hash: string;
  files: Record<string, string>;
}

const expected: ExpectedFixture = JSON.parse(
  readFileSync(resolve(FIXTURE_DIR, "../hash-fixture.expected.json"), "utf8")
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
});
