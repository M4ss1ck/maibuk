// The File System Access double the Reader spec picks files with (#653).
// Maibuk's web File Grant store (`src/lib/platform/web/file-grants.ts`) calls
// `window.showOpenFilePicker`, keeps the returned handle in IndexedDB, and reads
// byte ranges through it after a reload. Playwright cannot drive the OS dialog,
// so this helper installs a picker that answers with a real `File` built from a
// committed fixture, plus the four handle methods the store asks a file handle
// for (`getFile`, `queryPermission`, `requestPermission`, `isSameEntry`) on
// `File.prototype`.
//
// A real `File` is the handle because IndexedDB stores it natively and gives it
// back as a `File` on the next load: the grant survives a reload exactly as a
// real `FileSystemFileHandle` does. A plain object with function properties
// would fail the structured clone and leave the grant session-only, and a class
// instance would come back without its prototype.
//
// This is setup, not behaviour: it replaces the browser's dialog and nothing in
// the app. The spec still opens the picker with a key press.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { REPO_ROOT } from "./seed/seeds";

/** One fixture file the double offers, by the name the Shelf will show. */
export interface PickerFile {
  /** The name the picked `File` carries, e.g. `twelve-pages.pdf`. */
  name: string;
  /** The fixture's path, absolute or relative to the repository root. */
  path: string;
  /** The MIME type; octet-stream unless a fixture has a better one. */
  type?: string;
  /**
   * The file's device lives at this path instead (a bench fixture generated in
   * a temporary directory), so `path` is read at call time.
   */
  absolute?: boolean;
}

/** What the init script is handed: names and bytes only, so it clones cleanly. */
interface PickerPayload {
  files: { name: string; base64: string; type: string }[];
}

/** The globals the init script installs, read by the helpers below. */
interface FilePickerGlobal {
  files: Map<string, { base64: string; type: string }>;
  missing: Set<string>;
  next: string | null;
}

const PICKER_GLOBAL = "__maibukE2EFilePicker";

/**
 * Installs the picker and the handle methods for every navigation after this
 * call. Call once per test, before the interaction that opens the dialog.
 */
export async function installFilePicker(page: Page, files: PickerFile[]): Promise<void> {
  const payload: PickerPayload = {
    files: files.map((file) => ({
      name: file.name,
      base64: readFileSync(file.absolute ? file.path : resolve(REPO_ROOT, file.path)).toString(
        "base64"
      ),
      type: file.type ?? "application/octet-stream",
    })),
  };
  await page.addInitScript(
    ({ globalName, files: seeded }: { globalName: string; files: PickerPayload["files"] }) => {
      const state: FilePickerGlobal = {
        files: new Map(seeded.map((file) => [file.name, { base64: file.base64, type: file.type }])),
        missing: new Set<string>(),
        next: null,
      };
      (window as unknown as Record<string, unknown>)[globalName] = state;

      const bytesOf = (base64: string): Uint8Array => {
        const binary = atob(base64);
        return Uint8Array.from(binary, (char) => char.charCodeAt(0));
      };

      const fileFor = (name: string): File => {
        const entry = state.files.get(name);
        if (entry === undefined) throw new Error(`E2E picker has no file named ${name}`);
        return new File([bytesOf(entry.base64).buffer as ArrayBuffer], name, {
          type: entry.type,
          // A fixed timestamp keeps `pickSessionOnly`'s equality check stable.
          lastModified: 1_700_000_000_000,
        });
      };

      type HandleFile = File & {
        getFile?: () => Promise<File>;
        queryPermission?: (descriptor: { mode: "read" }) => Promise<string>;
        requestPermission?: (descriptor: { mode: "read" }) => Promise<string>;
        isSameEntry?: (other: HandleFile) => Promise<boolean>;
      };

      const prototype = File.prototype as HandleFile;
      if (prototype.getFile === undefined) {
        Object.defineProperties(prototype, {
          getFile: {
            configurable: true,
            writable: true,
            value: async function (this: File) {
              if (state.missing.has(this.name)) {
                throw new DOMException("The file is gone", "NotFoundError");
              }
              return this;
            },
          },
          queryPermission: {
            configurable: true,
            writable: true,
            value: async function (this: File) {
              // A missing file still answers "granted": the store then asks for
              // the file and gets NotFoundError, which the Shelf reads as missing.
              return "granted";
            },
          },
          requestPermission: {
            configurable: true,
            writable: true,
            value: async function () {
              return "granted";
            },
          },
          isSameEntry: {
            configurable: true,
            writable: true,
            value: async function (this: File, other: HandleFile) {
              return (
                other instanceof File &&
                other.name === this.name &&
                other.size === this.size &&
                other.lastModified === this.lastModified
              );
            },
          },
        });
      }

      const picker = async (): Promise<HandleFile[]> => {
        const name = state.next ?? state.files.keys().next().value;
        if (typeof name !== "string") return [];
        state.next = null;
        return [fileFor(name) as HandleFile];
      };
      (window as unknown as Record<string, unknown>).showOpenFilePicker = picker;
    },
    { globalName: PICKER_GLOBAL, files: payload.files }
  );
}

/** Makes the next pick answer with `name` instead of the first file installed. */
export async function chooseNextFile(page: Page, name: string): Promise<void> {
  await page.evaluate(
    ({ globalName, name: next }) => {
      const state = (window as unknown as Record<string, unknown>)[globalName] as
        | FilePickerGlobal
        | undefined;
      if (state === undefined) throw new Error("the E2E file picker is not installed");
      state.next = next;
    },
    { globalName: PICKER_GLOBAL, name }
  );
}

/** Makes `name`'s `getFile` fail, or lets it read again (Missing Document). */
export async function setFileMissing(page: Page, name: string, missing: boolean): Promise<void> {
  await page.evaluate(
    ({ globalName, name: file, missing: gone }) => {
      const state = (window as unknown as Record<string, unknown>)[globalName] as
        | FilePickerGlobal
        | undefined;
      if (state === undefined) throw new Error("the E2E file picker is not installed");
      if (gone) state.missing.add(file);
      else state.missing.delete(file);
    },
    { globalName: PICKER_GLOBAL, name, missing }
  );
}
