// The one `test` every spec imports. Each test gets a fresh browser context
// (Playwright default; a persistent one when WebKit needs the Plugin Directory,
// see `needsPersistentContext`) and a prepared device (seed Library + Tutorial
// progress).

import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type BrowserContext, test as base, expect } from "@playwright/test";
import { REPO_ROOT } from "./seed/seeds";
import {
  needsPersistentContext,
  prepareDevice,
  type BuiltInPluginSeed,
  type LibrarySeed,
  type PluginApprovalSeed,
  type PluginSeed,
  type PluginSeedEntry,
  type TutorialProgressSeed,
} from "./storage";

interface Options {
  /** Named seed Library written to IndexedDB before the app boots. */
  library: LibrarySeed;
  /** Specs default to a dismissed offer; Tutorial specs set `clean`. */
  tutorialProgress: TutorialProgressSeed;
  /** Fixture Plugins written into the web Plugin Directory (OPFS) with their approvals. */
  plugins: Iterable<PluginSeed | PluginSeedEntry>;
  /** Fixture Plugins written into OPFS with no approval record (installed but unapproved). */
  unapprovedPlugins: PluginSeed[];
  /** Approval records written as declared, overriding the default per Plugin. */
  pluginApprovals: PluginApprovalSeed[];
  /** Built-in Plugins the E2E seam reports for the seeded folders. */
  builtInPlugins: BuiltInPluginSeed[];
  /** The test installs a Plugin with none seeded; WebKit then needs a persistent context. */
  usesPluginDirectory: boolean;
  /**
   * A spec whose Library must survive a reload. WebKit has OPFS only in a
   * persistent context, and an in-memory fallback Library is not kept, so the
   * spec gets one there; every other engine keeps its normal context.
   */
  persistentContext: boolean;
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

const VENDOR_MODELS = resolve(REPO_ROOT, "vendor/moonshine/models");
// The catalog is the same data the app ships; read it as data so the harness
// needs no app import. Each entry's file `url` maps to the file
// `pnpm fetch:dictation --test-assets` put on disk.
const CATALOG = JSON.parse(
  readFileSync(resolve(REPO_ROOT, "src/features/dictation/catalog.json"), "utf8")
) as { id: string; files: { name: string; url: string }[] }[];
const MODEL_FILES = new Map(
  CATALOG.flatMap((spec) =>
    spec.files.map((f) => [f.url, join(VENDOR_MODELS, spec.id, f.name)] as const)
  )
);

/**
 * Hermetic network. Nothing leaves the machine: 127.0.0.1 (the preview server,
 * and the Sync lane's PocketBase) is the only origin. A spec that needs a
 * stubbed external call (Word Lookup) registers its own page.route, which
 * takes precedence.
 */
export async function makeHermetic(context: BrowserContext): Promise<void> {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
  // The update check reads GitHub tags; no tags means "no update".
  await context.route("https://api.github.com/repos/M4ss1ck/maibuk/tags*", (route) =>
    route.fulfill({ json: [] })
  );
  // Dictation Models come from vendor/ (pnpm fetch:dictation --test-assets),
  // never the network. Unknown files 404, which the settings spec relies on.
  // Registered after the catch-all abort: a later route takes precedence.
  await context.route(/^https:\/\/download\.moonshine\.ai\//, (route) => {
    const file = MODEL_FILES.get(route.request().url());
    return file && existsSync(file)
      ? route.fulfill({ path: file })
      : route.fulfill({ status: 404 });
  });
}

export const test = base.extend<Options & Fixtures>({
  library: ["empty", { option: true }],
  tutorialProgress: ["dismissed", { option: true }],
  plugins: [[], { option: true }],
  unapprovedPlugins: [[], { option: true }],
  pluginApprovals: [[], { option: true }],
  builtInPlugins: [[], { option: true }],
  usesPluginDirectory: [false, { option: true }],
  persistentContext: [false, { option: true }],
  macPlatform: [false, { option: true }],

  mod: async ({ macPlatform }, use) => {
    await use(macPlatform ? "Meta" : "ControlOrMeta");
  },

  // A persistent context launched through the `playwright` fixture runs the
  // same hooks as the default one: the project's launch options, its and
  // `test.use`'s context options, tracing, and failure screenshots all apply.
  context: async (
    {
      context,
      browserName,
      playwright,
      plugins,
      unapprovedPlugins,
      usesPluginDirectory,
      persistentContext,
    },
    use
  ) => {
    const wantsPersistent =
      needsPersistentContext({ browserName, plugins, unapprovedPlugins, usesPluginDirectory }) ||
      (persistentContext && browserName === "webkit");
    if (!wantsPersistent) {
      await use(context);
      return;
    }
    const profile = await mkdtemp(join(tmpdir(), "maibuk-e2e-webkit-"));
    try {
      // The launch opens a blank page and the built-in `page` fixture opens the
      // test's own beside it. Keep the blank one: closing WebKit's last window
      // aborts MiniBrowser before the next `newPage`.
      const persistent = await playwright[browserName].launchPersistentContext(profile);
      try {
        await use(persistent);
      } finally {
        await persistent.close();
      }
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  },

  page: async (
    {
      page,
      library,
      tutorialProgress,
      plugins,
      unapprovedPlugins,
      pluginApprovals,
      builtInPlugins,
      macPlatform,
    },
    use
  ) => {
    await makeHermetic(page.context());
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
    await prepareDevice(page, {
      library,
      tutorial: tutorialProgress,
      plugins,
      unapprovedPlugins,
      pluginApprovals,
      builtInPlugins,
    });
    await use(page);
  },
});

export { expect };
