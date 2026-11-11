// The browser's Save dialog has no path a keyboard-driven Playwright run can
// take. Playwright cannot drive an OS dialog, and Chromium's
// `showSaveFilePicker` answers every call with `AbortError` in a window it
// cannot put a dialog on (WebKit and Firefox have no picker at all). The web
// Plugin File Saver is written for exactly that case (`src/lib/platform/web/
// file-save.ts`, ADR 0040): with no picker, it hands the bytes to the browser's
// download instead, and the spec reads the file the browser reports.
//
// This is setup, not behaviour, the way `support/file-picker.ts` stands in for
// the open dialog: it removes the picker so the app takes its own documented
// fallback. Call it once per test, before the first page load.

import type { Page } from "@playwright/test";

/** Makes this page hand every Plugin save to the browser's download, not a picker. */
export async function forceDownloadSaves(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      writable: true,
      value: undefined,
    });
  });
}
