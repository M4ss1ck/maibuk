// Periodic lane for the Plugin start's host-side work (issue #436, the #401
// per-start budget: < 10 ms host main thread per start, no long task > 50 ms).
// Run `pnpm bench:plugin-start`; scripts/plugin-start-bench-budget.mjs fails
// the run when the p99 budget is missed. Never part of `pnpm test`: the gate
// lane has no timing assertions. A fake frame stands in for the sandbox, so
// the number covers the host path (pinned hash, manifest, modules, gate,
// broker round trips), not the Worker; the decision's browser `bench:plugins`
// pieces (launch delta, start-to-ready on Chromium/WebKitGTK, Command latency,
// keystroke echo) are still to come.
import { bench, describe } from "vitest";
import { savePluginApproval } from "@/features/plugins/approvals";
import { hashPluginDirectory } from "@/features/plugins/directory-hash";
import { createPluginLifecycle } from "@/features/plugins/lifecycle";
import type { PluginDirectoryAdapter } from "@/lib/platform/types";
import {
  fakePluginFrame,
  installMicrotaskMessageChannel,
  pluginFolder,
} from "@/test/support/plugin-fixtures";

installMicrotaskMessageChannel();

const folder = pluginFolder({}, { id: "bench", name: "Bench" });
savePluginApproval({
  pluginId: "bench",
  pinnedHash: await hashPluginDirectory(folder.files),
  granted: [],
  enabled: true,
  approvedVersion: "",
  approvedPermissions: { required: [], optional: [] },
  approvedFiles: {},
});

const directory: PluginDirectoryAdapter = {
  listFolders: async () => ["bench"],
  readFolder: async (name) => (name === "bench" ? folder : null),
};

const dataVersions = new Map<string, number>();

const lifecycle = createPluginLifecycle({
  directory,
  createFrame: () => fakePluginFrame(),
  scheduleIdle: (work) => work(),
  whenLaunchSettled: async () => undefined,
  dataVersions: {
    get: async (pluginId) => dataVersions.get(pluginId) ?? null,
    set: async (pluginId, version) => {
      dataVersions.set(pluginId, version);
    },
  },
});
await lifecycle.launch();

describe("plugin start", () => {
  bench("host start: ready", async () => {
    await lifecycle.start("bench", "enable");
    lifecycle.stop("bench");
  });
});
