// Arms the Update flow through the E2E lane's test-only seam
// (`window.__maibukUpdateSeam`, src/features/update/e2e-seam.ts, installed only
// in the E2E lane's build). Playwright drives the web build, whose updater
// reports `unknown`; the seam hands the app a scripted adapter and a newer
// Release. Setup-only, like the storage helpers: a spec asserts on the UI.

import type { Page } from "@playwright/test";
import type { UpdateSeamScript } from "../../src/features/update/e2e-seam";

export type { UpdateSeamScript };

export async function armUpdate(page: Page, script: UpdateSeamScript): Promise<void> {
  await page.waitForFunction(() => "__maibukUpdateSeam" in window);
  await page.evaluate((armed) => window.__maibukUpdateSeam?.arm(armed), script);
}
