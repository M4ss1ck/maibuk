// The one `test` every spec imports. Each test gets a fresh browser context
// (Playwright default), a prepared device (seed Library + Tutorial progress),
// and the sql.js wasm served from node_modules instead of the CDN.

import { resolve } from "node:path";
import { test as base, expect } from "@playwright/test";
import { REPO_ROOT } from "./seed/seeds";
import { prepareDevice, type LibrarySeed, type TutorialProgressSeed } from "./storage";

interface Options {
  /** Named seed Library written to IndexedDB before the app boots. */
  library: LibrarySeed;
  /** Specs default to a dismissed offer; Tutorial specs set `clean`. */
  tutorialProgress: TutorialProgressSeed;
  /** Set by the mac-platform project. */
  macPlatform: boolean;
}

interface Fixtures {
  /**
   * The platform's Mod key as an author presses it. ControlOrMeta follows the
   * host OS, not the spoofed navigator.platform, so mac-platform specs press
   * Meta through this; TipTap's Mod answers only to Meta on a Mac.
   */
  mod: "ControlOrMeta" | "Meta";
}

const SQL_WASM = resolve(REPO_ROOT, "node_modules/sql.js/dist/sql-wasm.wasm");

export const test = base.extend<Options & Fixtures>({
  library: ["empty", { option: true }],
  tutorialProgress: ["dismissed", { option: true }],
  macPlatform: [false, { option: true }],

  mod: async ({ macPlatform }, use) => {
    await use(macPlatform ? "Meta" : "ControlOrMeta");
  },

  page: async ({ page, library, tutorialProgress, macPlatform }, use) => {
    // Hermetic network. Nothing leaves the machine: the preview server is the
    // only origin. A spec that needs a stubbed external call (Word Lookup)
    // registers its own page.route, which takes precedence.
    const context = page.context();
    await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
    // The web adapter loads sql.js wasm from sql.js.org; serve the copy the
    // bundled JS glue ships with, so it is offline and version-matched.
    await context.route("https://sql.js.org/dist/sql-wasm.wasm", (route) =>
      route.fulfill({ path: SQL_WASM, contentType: "application/wasm" })
    );
    // The update check reads GitHub tags; no tags means "no update".
    await context.route("https://api.github.com/repos/M4ss1ck/maibuk/tags*", (route) =>
      route.fulfill({ json: [] })
    );
    if (macPlatform) {
      // isMac() prefers userAgentData.platform; TipTap reads navigator.platform.
      await page.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel" });
        const uaData = (navigator as Navigator & { userAgentData?: object }).userAgentData;
        if (uaData) {
          Object.defineProperty(Object.getPrototypeOf(uaData), "platform", { get: () => "macOS" });
        }
      });
    }
    await prepareDevice(page, { library, tutorial: tutorialProgress });
    await use(page);
  },
});

export { expect };
