/**
 * The web Plugin File Saver (ADR 0040): where the browser has the File System
 * Access API the save picker writes the bytes where the author chooses; a
 * browser without it, or one that refuses the picker (an insecure page, no user
 * activation), hands the file to the browser's download instead. Either way the
 * bytes leave the host and a Plugin never sees a path.
 */

import type { PluginFileSaver } from "@/lib/platform/types";

// Only the slice of the File System Access API this saver uses: the project has
// no @types package for it.
interface SaveFilePickerOptions {
  suggestedName: string;
  types: { accept: Record<string, string[]> }[];
}

interface WritableFileHandle {
  createWritable(): Promise<WritableStream<Uint8Array>>;
}

type ShowSaveFilePicker = (options: SaveFilePickerOptions) => Promise<WritableFileHandle>;

/** The extra arguments tests substitute; the app passes none. */
export interface WebPluginFileSaveDeps {
  /** `window.showSaveFilePicker`; absent means a plain download. */
  showSaveFilePicker?: ShowSaveFilePicker;
  /** How a file reaches the browser without a picker; a download by default. */
  download?: (blob: Blob, name: string) => void;
}

// DOMException is not an Error in every browser, so read `name` structurally.
function errorName(error: unknown): string {
  return typeof error === "object" && error !== null && "name" in error
    ? String((error as { name: unknown }).name)
    : "";
}

function windowPicker(): ShowSaveFilePicker | null {
  const picker = (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  return typeof picker === "function" ? (picker as ShowSaveFilePicker).bind(globalThis) : null;
}

// The picker filters to the name's own extension, so a Plugin cannot offer a
// type the author would not expect to save.
function saveTypes(name: string, mimeType: string): SaveFilePickerOptions["types"] {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return [];
  return [{ accept: { [mimeType || "application/octet-stream"]: [name.slice(dot)] } }];
}

// The fallback every browser has: an object URL on a hidden anchor, revoked
// once the browser has taken the file.
function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The browser saver the app registers on the web build. */
export function createWebPluginFileSaver(deps: WebPluginFileSaveDeps = {}): PluginFileSaver {
  const download = deps.download ?? downloadBlob;

  return {
    async save(name, mimeType, blob): Promise<"saved" | "cancelled"> {
      const picker = deps.showSaveFilePicker ?? windowPicker();
      if (picker === null) {
        download(blob, name);
        return "saved";
      }

      let handle: WritableFileHandle;
      try {
        handle = await picker({ suggestedName: name, types: saveTypes(name, mimeType) });
      } catch (error) {
        const reason = errorName(error);
        if (reason === "AbortError") return "cancelled";
        // A page the browser will not show the picker on falls back to the
        // download; any other failure is a real one and reaches the Plugin.
        if (reason === "SecurityError" || reason === "NotAllowedError") {
          download(blob, name);
          return "saved";
        }
        throw error;
      }

      const writable = await handle.createWritable();
      // `pipeTo` aborts the writable when a chunk fails, so a failed save leaves
      // no writable open.
      await blob.stream().pipeTo(writable);
      return "saved";
    },
  };
}
