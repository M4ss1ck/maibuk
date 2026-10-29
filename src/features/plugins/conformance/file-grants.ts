/**
 * The known file the File Grant conformance check seeds (#653, ADR 0036). The
 * seam reads it through a memory File Grant store and reports the bytes it got
 * back; `checks.ts` decides, against the ranges declared here, whether
 * `files.read`, `files.stat`, and `files.release` behaved as the Plugin API
 * promises. Keeping the file and its ranges in one module means the probe and
 * the pass rule cannot drift apart.
 */

/** The Plugin id the probe seeds its file under: no real Plugin has this id. */
export const FILE_GRANT_PROBE_PLUGIN_ID = "conformance-file-grants";

/** Writes bytes as lowercase hex, so an observation is one comparable string. */
export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The file the probe seeds: readable ASCII, so a failing diff still reads as text. */
export const CONFORMANCE_FILE = {
  name: "conformance.txt",
  bytes: new TextEncoder().encode("Maibuk reads a picked file in ranges, never by path."),
  modified: 1_700_000_000_000,
} as const;

const RANGE_OFFSET = 7;
const RANGE_LENGTH = 12;
const TAIL_BYTES = 4;

/** The mid-file range the probe reads, and the bytes that must come back. */
export const CONFORMANCE_FILE_RANGE = {
  offset: RANGE_OFFSET,
  length: RANGE_LENGTH,
  hex: toHex(CONFORMANCE_FILE.bytes.subarray(RANGE_OFFSET, RANGE_OFFSET + RANGE_LENGTH)),
} as const;

/** The read that starts inside the file and ends past it, so it must come back short. */
export const CONFORMANCE_FILE_TAIL = {
  offset: CONFORMANCE_FILE.bytes.length - TAIL_BYTES,
  length: 64,
  hex: toHex(CONFORMANCE_FILE.bytes.subarray(CONFORMANCE_FILE.bytes.length - TAIL_BYTES)),
} as const;
