/**
 * The seam a Plugin File Saver fills (ADR 0040). A Plugin hands the host one
 * file, as a cloned `Blob`, and the host writes it where the author chooses:
 * this module owns the name the dialog is prefilled with, the extensions the
 * host refuses, and the registry the `files.save` handler reads. The bytes never
 * reach a Plugin again, and a save creates no File Grant.
 *
 * The app registers a platform saver at startup (the desktop and web savers);
 * until one is registered a `files.save` call refuses `not-implemented`, which
 * is what Android answers (#740). The memory saver records what it was handed,
 * so a Plugin's own test can assert the bytes the host received.
 */

import type { PluginFileSaveRecord } from "@/features/plugins/types";
import type { PluginFileSaver } from "@/lib/platform/types";
import { PluginApiError, utf8ByteLength } from "@/plugin-sdk/protocol";

export type { PluginFileSaver } from "@/lib/platform/types";

/** Longest file name the host keeps, in UTF-8 bytes, extension included. */
export const MAX_SAVE_NAME_BYTES = 255;

/**
 * Extensions the host refuses: an author's click on a save dialog must never
 * write a program or an installer. Compared case-insensitively.
 */
export const SAVE_EXTENSION_BLOCKLIST: ReadonlySet<string> = new Set([
  "exe",
  "msi",
  "bat",
  "cmd",
  "com",
  "scr",
  "ps1",
  "sh",
  "app",
  "dmg",
  "pkg",
  "deb",
  "rpm",
  "appimage",
  "desktop",
  "jar",
  "lnk",
]);

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

let installedSaver: PluginFileSaver | null = null;

/** Registers the saver `files.save` writes through; null clears it. */
export function registerPluginFileSaver(saver: PluginFileSaver | null): void {
  installedSaver = saver;
}

/** The registered saver, or null when this device cannot save yet. */
export function getPluginFileSaver(): PluginFileSaver | null {
  return installedSaver;
}

/** The memory saver, with the test-only hooks a Plugin test drives it with. */
export interface MemoryPluginFileSaver extends PluginFileSaver {
  /** Every save this saver wrote, in order, with the bytes it received. */
  readonly saves: ReadonlyArray<PluginFileSaveRecord>;
  /** Queues a cancel: the next `save` reports `cancelled` and records nothing. */
  queueCancel(): void;
}

/**
 * The default test saver: it keeps every file the host writes in memory, so a
 * Plugin test asserts the bytes and the name the host received instead of
 * opening a dialog. `queueCancel()` plays the author closing that dialog.
 */
export function createMemoryPluginFileSaver(): MemoryPluginFileSaver {
  const saves: PluginFileSaveRecord[] = [];
  const cancels: boolean[] = [];

  return {
    saves,
    queueCancel(): void {
      cancels.push(true);
    },
    async save(name, mimeType, blob): Promise<"saved" | "cancelled"> {
      if (cancels.shift() === true) return "cancelled";
      saves.push({ name, mimeType, bytes: new Uint8Array(await blob.arrayBuffer()) });
      return "saved";
    },
  };
}

/** Cuts `text` to at most `bytes` UTF-8 bytes without splitting a code point. */
function cutToBytes(text: string, bytes: number): string {
  let out = "";
  let used = 0;
  for (const character of text) {
    const size = utf8ByteLength(character);
    if (used + size > bytes) break;
    out += character;
    used += size;
  }
  return out;
}

/**
 * The one name the host keeps from what a Plugin asked for: the base name only
 * (no folder part), no control characters, no leading dots (never a hidden
 * file), trimmed, and at most 255 UTF-8 bytes with its extension kept whole.
 */
export function cleanSaveName(name: string): string {
  const base = name.slice(Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\")) + 1);
  const withoutControls = base.replace(CONTROL_CHARACTERS, "").trim();
  const visible = withoutControls.replace(/^\.+/, "").trim();
  if (utf8ByteLength(visible) <= MAX_SAVE_NAME_BYTES) return visible;

  const dot = visible.lastIndexOf(".");
  const extension = dot > 0 ? visible.slice(dot) : "";
  const stem = extension === "" ? visible : visible.slice(0, dot);
  const extensionBytes = utf8ByteLength(extension);
  if (extensionBytes >= MAX_SAVE_NAME_BYTES) return cutToBytes(visible, MAX_SAVE_NAME_BYTES);
  return `${cutToBytes(stem, MAX_SAVE_NAME_BYTES - extensionBytes)}${extension}`;
}

/**
 * Why a cleaned name may not be saved, or null when it may: the host refuses a
 * name with no extension, and one whose extension is on the executable
 * blocklist. `html` and `svg` are allowed.
 */
export function saveNameError(cleaned: string): string | null {
  const dot = cleaned.lastIndexOf(".");
  if (dot <= 0 || dot === cleaned.length - 1) {
    return `The file name ${JSON.stringify(cleaned)} has no extension`;
  }
  const extension = cleaned.slice(dot + 1).toLowerCase();
  if (SAVE_EXTENSION_BLOCKLIST.has(extension)) {
    return `Maibuk refuses to save an executable file (${JSON.stringify(extension)})`;
  }
  return null;
}

/**
 * The whole `files.save` flow the handler and the test kit share: the saver has
 * to exist (else `not-implemented`), the name has to clean up to something the
 * host may write (else `invalid-params`), and a saver failure reaches the Plugin
 * as `internal-error` carrying its message.
 */
export async function savePluginFile(
  saver: PluginFileSaver | null,
  request: { name: string; mimeType: string; blob: Blob | undefined }
): Promise<"saved" | "cancelled"> {
  if (saver === null) {
    throw new PluginApiError({
      code: "not-implemented",
      message: "Saving a file is not available on this device yet",
    });
  }
  const cleaned = cleanSaveName(request.name);
  const problem = saveNameError(cleaned);
  if (problem !== null) throw new PluginApiError({ code: "invalid-params", message: problem });
  if (request.blob === undefined) {
    throw new PluginApiError({
      code: "invalid-params",
      message: "files.save needs the file's bytes in the blob message",
    });
  }
  try {
    return await saver.save(cleaned, request.mimeType, request.blob);
  } catch (error) {
    if (error instanceof PluginApiError) throw error;
    throw new PluginApiError({
      code: "internal-error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
