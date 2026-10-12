/**
 * The launch startup error (#442, item 5). A Plugin that fails to start at app
 * launch — a scan refusal or a start failure — has the error recorded on its
 * approval record so Settings shows it; the next successful start clears it.
 * A refusal without its own message is stored as its stable code (`incompatible`,
 * `module-refused`, `manifest-invalid`); one with a message stores the message.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PLUGIN_APPROVALS_STORAGE_KEY,
  getPluginApproval,
  savePluginApproval,
} from "@/features/plugins/approvals";
import { resetPluginContributionsForTests } from "@/features/plugins/contributions";
import { hashPluginDirectory } from "@/features/plugins/directory-hash";
import { createPluginLifecycle } from "@/features/plugins/lifecycle";
import type { PluginFolder, PluginLifecycle } from "@/features/plugins/types";
import type { PluginDirectoryAdapter } from "@/lib/platform/types";
import {
  PLUGIN_MANIFEST,
  fakePluginFrame,
  installMicrotaskMessageChannel,
  pluginFolder,
  sourceFolder,
} from "@/test/support/plugin-fixtures";

const lifecycles: PluginLifecycle[] = [];
let restoreMessageChannel: (() => void) | null = null;

beforeEach(() => {
  restoreMessageChannel = installMicrotaskMessageChannel();
});

afterEach(() => {
  for (const lifecycle of lifecycles.splice(0)) lifecycle.dispose();
  restoreMessageChannel?.();
  restoreMessageChannel = null;
  localStorage.removeItem(PLUGIN_APPROVALS_STORAGE_KEY);
  resetPluginContributionsForTests();
});

async function seedApproved(folder: PluginFolder): Promise<void> {
  savePluginApproval({
    pluginId: folder.name,
    pinnedHash: await hashPluginDirectory(folder.files),
    granted: [],
    enabled: true,
    approvedVersion: "1.0.0",
    approvedPermissions: { required: [], optional: [] },
    approvedFiles: {},
  });
}

function makeLifecycle(folder: PluginFolder, fail: boolean): PluginLifecycle {
  const folders = new Map([[folder.name, folder]]);
  const directory: PluginDirectoryAdapter = {
    listFolders: async () => [...folders.keys()],
    readFolder: async (name) => folders.get(name) ?? null,
  };
  const lifecycle = createPluginLifecycle({
    directory,
    createFrame: () => (fail ? fakePluginFrame({ fail: "boom" }) : fakePluginFrame()),
    scheduleIdle: (work) => work(),
    whenLaunchSettled: async () => undefined,
    dataVersions: { get: async () => null, set: async () => undefined },
  });
  lifecycles.push(lifecycle);
  return lifecycle;
}

describe("Plugin launch startup error", () => {
  it("records a start failure at launch and clears it on the next successful start", async () => {
    const folder = pluginFolder({}, { id: "tracer", name: "tracer" });
    await seedApproved(folder);

    const failing = makeLifecycle(folder, true);
    await failing.launch();
    expect(getPluginApproval("tracer")?.startupError).toBe("boom");

    const working = makeLifecycle(folder, false);
    await working.launch();
    expect(getPluginApproval("tracer")?.startupError).toBeUndefined();
  });

  it("records a scan refusal (invalid manifest) as its code", async () => {
    const folder = sourceFolder({ "manifest.json": "not json", "index.js": "export {}" });
    await seedApproved(folder);

    const lifecycle = makeLifecycle(folder, false);
    await lifecycle.launch();

    expect(getPluginApproval("tracer")?.startupError).toBe("manifest-invalid");
  });

  it("records an incompatible manifest as its code", async () => {
    const folder = pluginFolder({}, { id: "tracer", name: "tracer", apiVersion: "^99.0" });
    await seedApproved(folder);

    const lifecycle = makeLifecycle(folder, false);
    await lifecycle.launch();

    expect(getPluginApproval("tracer")?.startupError).toBe("incompatible");
  });

  it("records a refused module as its code", async () => {
    // A valid manifest whose declared entry file is missing: the module plan
    // refuses it as `module-refused`.
    const folder = sourceFolder({
      "manifest.json": JSON.stringify({ ...PLUGIN_MANIFEST, id: "tracer", name: "tracer" }),
    });
    await seedApproved(folder);

    const lifecycle = makeLifecycle(folder, false);
    await lifecycle.launch();

    expect(getPluginApproval("tracer")?.startupError).toBe("module-refused");
  });
});
