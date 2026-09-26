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

/**
 * Makes the web adapters' blob download fail (a browser-API boundary fault):
 * the anchor `downloadFile` builds cannot get an object URL, so the caller's
 * error path runs. Throws a non-Error on purpose, so the Export dialog shows
 * its localized failure message instead of a raw exception string.
 */
export async function failBlobDownloads(page: Page): Promise<void> {
  await page.evaluate(() => {
    URL.createObjectURL = () => {
      // biome-ignore lint/style/useThrowOnlyError: the dialog surfaces t() for non-Errors.
      throw "blob download blocked by the e2e fault";
    };
  });
}

/**
 * Flips the stored checksum of every web Backup, so the next restore must
 * refuse it. Leaves the SQL bytes alone: only the verification fails, exactly
 * like a Backup whose file changed after it was written (decision 19).
 */
export async function tamperBackupChecksums(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("maibuk-backups", 2);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("backups", "readwrite");
          const store = tx.objectStore("backups");
          const request = store.getAll();
          request.onsuccess = () => {
            for (const entry of request.result as { filename: string; checksum: string }[]) {
              store.put({ ...entry, checksum: `tampered-${entry.checksum}` });
            }
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      })
  );
}
