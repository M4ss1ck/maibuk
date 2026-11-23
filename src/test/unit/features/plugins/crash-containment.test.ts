// @vitest-environment jsdom
/**
 * Crash containment (#927). The death record Android writes when the renderer
 * is killed for memory names the Plugins active in the seconds before. A
 * foreground death disables them at the next launch and says so; a background
 * death is silent.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPluginApprovals,
  getPluginApproval,
  savePluginApproval,
} from "@/features/plugins/approvals";
import { clearKnownPlugins, saveKnownPlugin } from "@/features/plugins/known";
import { PLUGIN_MANIFEST } from "@/test/support/plugin-fixtures";

const AT = 100_000;

function approve(pluginId: string): void {
  savePluginApproval({
    pluginId,
    pinnedHash: "h1:pinned",
    granted: [],
    enabled: true,
    approvedVersion: "1.0.0",
    approvedPermissions: { required: [], optional: [] },
    approvedFiles: {},
  });
}

function know(pluginId: string, name: string): void {
  saveKnownPlugin({
    pluginId,
    manifest: { ...PLUGIN_MANIFEST, id: pluginId, name },
    builtIn: false,
    removed: false,
  });
}

function recordJson(
  options: { foreground?: boolean; plugins?: { pluginId: string; lastActivityAt: number }[] } = {}
): string {
  return JSON.stringify({
    at: AT,
    didCrash: true,
    rendererPriorityAtExit: 0,
    foreground: options.foreground ?? true,
    plugins: options.plugins ?? [],
    appVersion: "1.0.0",
    androidVersion: "15",
    webViewVersion: "130.0.6723.58",
  });
}

/**
 * The toast store is private and a sticky toast never auto-dismisses, so each
 * case loads its own copy of the modules: a fresh store beside the same
 * localStorage an approval or known record was seeded into.
 */
async function applyAndReadToasts(take: () => string | null): Promise<string[]> {
  vi.resetModules();
  const [{ applyDeathRecord }, { currentToastMessages }] = await Promise.all([
    import("@/features/plugins/crash-containment"),
    import("@/components/ui/Toast"),
  ]);
  applyDeathRecord({ bridge: () => ({ take }) });
  return currentToastMessages();
}

beforeEach(() => {
  clearPluginApprovals();
  clearKnownPlugins();
});

describe("Plugin crash containment (#927)", () => {
  it("disables a Plugin active in the blame window and leaves an idle one enabled", async () => {
    approve("alpha");
    approve("idle");
    know("alpha", "Alpha");
    know("idle", "Idle");

    const messages = await applyAndReadToasts(() =>
      recordJson({
        plugins: [
          { pluginId: "alpha", lastActivityAt: AT - 5_000 },
          { pluginId: "idle", lastActivityAt: AT - 30_000 },
        ],
      })
    );

    expect(getPluginApproval("alpha")).toMatchObject({ enabled: false });
    expect(getPluginApproval("idle")).toMatchObject({ enabled: true });
    expect(messages).toEqual(["Maibuk ran out of memory and restarted. Disabled: Alpha."]);
  });

  it("names every disabled Plugin in one toast", async () => {
    approve("alpha");
    approve("beta");
    know("alpha", "Alpha");
    know("beta", "Beta");

    const messages = await applyAndReadToasts(() =>
      recordJson({
        plugins: [
          { pluginId: "alpha", lastActivityAt: AT - 1_000 },
          { pluginId: "beta", lastActivityAt: AT },
        ],
      })
    );

    expect(getPluginApproval("alpha")).toMatchObject({ enabled: false });
    expect(getPluginApproval("beta")).toMatchObject({ enabled: false });
    expect(messages).toEqual(["Maibuk ran out of memory and restarted. Disabled: Alpha, Beta."]);
  });

  it("disables nothing and shows nothing after a background death", async () => {
    approve("alpha");
    know("alpha", "Alpha");

    const messages = await applyAndReadToasts(() =>
      recordJson({
        foreground: false,
        plugins: [{ pluginId: "alpha", lastActivityAt: AT - 1_000 }],
      })
    );

    expect(getPluginApproval("alpha")).toMatchObject({ enabled: true });
    expect(messages).toEqual([]);
  });

  it("shows the plain restart toast when no Plugin was active", async () => {
    approve("alpha");
    know("alpha", "Alpha");

    const messages = await applyAndReadToasts(() =>
      recordJson({ plugins: [{ pluginId: "alpha", lastActivityAt: AT - 30_000 }] })
    );

    expect(getPluginApproval("alpha")).toMatchObject({ enabled: true });
    expect(messages).toEqual(["Maibuk restarted because it ran out of memory."]);
  });

  it("takes the record once per application", async () => {
    const take = vi.fn(() => recordJson());
    vi.resetModules();
    const { applyDeathRecord } = await import("@/features/plugins/crash-containment");
    const bridge = () => ({ take });

    applyDeathRecord({ bridge });
    applyDeathRecord({ bridge });

    expect(take).toHaveBeenCalledTimes(2);
  });

  it("does nothing without a bridge, a null record, a throwing take, or unparsable JSON", async () => {
    approve("alpha");

    const messages: string[] = [];
    const takes = [
      () => null,
      () => {
        throw new Error("bridge exploded");
      },
      () => "not json",
      () => JSON.stringify({ at: "later", foreground: true, plugins: [] }),
    ];
    for (const take of takes) {
      messages.push(...(await applyAndReadToasts(take)));
    }

    vi.resetModules();
    const { applyDeathRecord } = await import("@/features/plugins/crash-containment");
    expect(() => applyDeathRecord({ bridge: () => undefined })).not.toThrow();

    expect(getPluginApproval("alpha")).toMatchObject({ enabled: true });
    expect(messages).toEqual([]);
  });
});
