// Fault injection at the browser-storage boundary only (decision 19). With
// storage.ts, the only code in the suite allowed to touch IndexedDB; specs
// call these helpers and never reach into storage themselves.

import type { Page } from "@playwright/test";

/**
 * Makes every IndexedDB put reject with a quota error until
 * `allowIndexedDbWrites` is called. Installed after the app has booted, so
 * the launch schema writes have already landed.
 */
export async function failIndexedDbWrites(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window as unknown as { __e2eFailPuts?: boolean };
    state.__e2eFailPuts = true;
    const proto = IDBObjectStore.prototype as IDBObjectStore & { __e2ePatched?: boolean };
    if (proto.__e2ePatched) return;
    proto.__e2ePatched = true;
    const original = proto.put;
    proto.put = function (this: IDBObjectStore, ...args: Parameters<typeof original>) {
      if ((window as unknown as { __e2eFailPuts?: boolean }).__e2eFailPuts) {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      }
      return original.apply(this, args);
    };
  });
}

/** Lets IndexedDB writes through again, so the next save can succeed. */
export async function allowIndexedDbWrites(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __e2eFailPuts?: boolean }).__e2eFailPuts = false;
  });
}
