/**
 * The known file the file-save conformance check hands the host (ADR 0040). The
 * seam calls `files.save` with these bytes through the real handler and a memory
 * saver, then reports what the saver received; `checks.ts` decides, against the
 * file declared here, whether the bytes arrived whole. Keeping the file and its
 * expectation in one module means the probe and the pass rule cannot drift.
 */

import { toHex } from "@/features/plugins/conformance/file-grants";

/** The Plugin id the probe saves under: no real Plugin has this id. */
export const FILE_SAVE_PROBE_PLUGIN_ID = "conformance-file-save";

/** The file the probe saves: readable ASCII, so a failing diff still reads as text. */
export const CONFORMANCE_SAVE = {
  name: "conformance-save.txt",
  mimeType: "text/plain",
  bytes: new TextEncoder().encode("Maibuk takes a Plugin's file as one cloned Blob."),
} as const;

/** The bytes the host must have received, as lowercase hex. */
export const CONFORMANCE_SAVE_HEX = toHex(CONFORMANCE_SAVE.bytes);
