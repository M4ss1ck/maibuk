/**
 * The pinned-hash scheme (ADR 0020): Go's `dirhash.Hash1` over a Plugin
 * folder's files, computed with Web Crypto. One summary line per file —
 * lowercase hex SHA-256, two spaces, POSIX-relative path, newline — with the
 * lines sorted by the path's UTF-8 bytes; SHA-256 of the summary, standard
 * base64, prefixed `h1:`. The web and Rust implementations read the same
 * fixture (`src/test/fixtures/plugins/hash-fixture`), so the two cannot drift.
 *
 * A file changed after the author pinned the folder produces a different
 * value; the runtime refuses it before any byte reaches a Worker.
 */

import type { PluginFolderFile } from "@/features/plugins/types";
import { computeChecksum } from "@/lib/checksum";

const encoder = new TextEncoder();

// Byte order over UTF-8, matching Go's `sort.Strings` on paths.
function compareUtf8(left: string, right: string): number {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/**
 * Every file's lowercase hex SHA-256, in the order the `h1:` summary writes
 * them: sorted by path. The per-file list is what a re-review diff shows.
 */
export async function pluginFileDigests(
  files: readonly PluginFolderFile[]
): Promise<Map<string, string>> {
  const sorted = [...files].sort((a, b) => compareUtf8(a.path, b.path));
  const digests = new Map<string, string>();
  for (const file of sorted) {
    digests.set(file.path, await computeChecksum(file.bytes));
  }
  return digests;
}

/** The folder's pinned `h1:` hash. */
export async function hashPluginDirectory(files: readonly PluginFolderFile[]): Promise<string> {
  const digests = await pluginFileDigests(files);
  let summary = "";
  for (const [path, digest] of digests) {
    summary += `${digest}  ${path}\n`;
  }
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(summary));
  return `h1:${toBase64(new Uint8Array(digest))}`;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
