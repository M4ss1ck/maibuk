/**
 * The Stopped Plugin read (#618): one answer, for a Plugin id, to "is this a
 * Stopped Plugin, and why", derived from a real lifecycle driven over fake
 * Plugin frames. The sidebar, the page, and the Settings row all read it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPluginApproval, savePluginApproval } from "@/features/plugins/approvals";
import { getPluginSidebarEntries } from "@/features/plugins/contributions-registry";
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_MISS_LIMIT,
  RESTART_DELAY_MS,
} from "@/features/plugins/lifecycle";
import { STARTUP_TIMEOUT_MS } from "@/features/plugins/runtime";
import {
  PLUGIN_SIDEBAR_SNAPSHOT_KEY,
  readPluginSidebarSnapshot,
  seedPluginSidebarFromSnapshot,
  writePluginSidebarSnapshot,
} from "@/features/plugins/sidebar-snapshot";
import { readStoppedPlugin } from "@/features/plugins/stopped";
import { pluginPageRoute } from "@/features/plugins/contributions-registry";
import type { PluginCommandId } from "@/lib/shortcut-registry";
import {
  advance,
  advanceUntil,
  createLifecycleHarness,
  disposeLifecycleHarness,
  invalidManifestFolder,
  pagePlugin,
} from "@/test/support/plugin-lifecycle-harness";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  disposeLifecycleHarness();
  vi.useRealTimers();
});

/** The sidebar entry a previous launch saved for `pluginId`'s report page. */
function savedEntry(pluginId: string) {
  return {
    pluginId,
    displayName: pluginId,
    pageId: "report",
    pageRoute: pluginPageRoute(pluginId, "report"),
    title: "Report",
    commandId: `plugin.${pluginId}.open` as PluginCommandId,
  };
}

describe("readStoppedPlugin: what counts as a Stopped Plugin", () => {
  it("is not stopped while ready, and is stopped with the reason after a crash", async () => {
    const h = await createLifecycleHarness({ approved: [pagePlugin("alpha")] });
    await h.launch();
    expect(h.lifecycle.state("alpha")?.status).toBe("ready");
    expect(readStoppedPlugin(h.lifecycle, "alpha")).toBeNull();

    h.framesFor("alpha")[0].signalError("boom");
    await advanceUntil(() => h.lifecycle.state("alpha")?.status === "stopped", "the crash");

    expect(readStoppedPlugin(h.lifecycle, "alpha")).toEqual({
      reason: { kind: "limit", reason: "crashed" },
      action: "tryAgain",
    });
  });

  it("is stopped after a startup that ran out of time", async () => {
    const h = await createLifecycleHarness({
      approved: [pagePlugin("alpha", { lifecycle: "on-demand" })],
      deferReady: true,
    });
    await h.launch();
    void h.lifecycle.start("alpha", "restart");
    // It starts out stopped (never ran): wait for the start's frame before the clock runs.
    await advanceUntil(() => h.framesFor("alpha").length === 1, "the start's frame");
    await advance(STARTUP_TIMEOUT_MS + 1);
    await advanceUntil(() => {
      const state = h.lifecycle.state("alpha");
      return state?.status === "stopped" && state.reason === "startup-timeout";
    }, "the timeout");

    expect(readStoppedPlugin(h.lifecycle, "alpha")).toEqual({
      reason: { kind: "limit", reason: "startup-timeout" },
      action: "tryAgain",
    });
  });

  it("is not stopped while only missing heartbeats, and is once it stops answering", async () => {
    const h = await createLifecycleHarness({ approved: [pagePlugin("alpha")] });
    await h.launch();
    h.framesFor("alpha")[0].holdAnswers = true;

    await advance(HEARTBEAT_INTERVAL_MS * 2);
    expect(h.lifecycle.state("alpha")?.status).toBe("unavailable");
    expect(readStoppedPlugin(h.lifecycle, "alpha")).toBeNull();

    // One interval at a time: the automatic restart is only a second after the stop.
    for (let beat = 0; beat < HEARTBEAT_MISS_LIMIT; beat += 1) {
      if (h.lifecycle.state("alpha")?.status === "stopped") break;
      await advance(HEARTBEAT_INTERVAL_MS);
    }
    expect(readStoppedPlugin(h.lifecycle, "alpha")).toEqual({
      reason: { kind: "limit", reason: "unresponsive" },
      action: "tryAgain",
    });
  });

  it("is not stopped after a requested or an idle stop", async () => {
    const h = await createLifecycleHarness({ approved: [pagePlugin("alpha")] });
    await h.launch();

    h.lifecycle.stop("alpha");
    expect(h.lifecycle.state("alpha")).toMatchObject({ status: "stopped", reason: "requested" });
    expect(readStoppedPlugin(h.lifecycle, "alpha")).toBeNull();

    await h.lifecycle.start("alpha", "restart");
    h.lifecycle.stop("alpha", "idle");
    expect(readStoppedPlugin(h.lifecycle, "alpha")).toBeNull();
  });

  it("is stopped with the startup error when its data is newer than the Plugin", async () => {
    const h = await createLifecycleHarness({
      approved: [pagePlugin("alpha", { dataVersion: 2 })],
      data: { alpha: 3 },
    });
    await h.launch();

    // A retry cannot fix newer data: the author updates the Plugin instead.
    expect(readStoppedPlugin(h.lifecycle, "alpha")).toEqual({
      reason: { kind: "refusal", startupError: "data-newer" },
      action: "review",
    });
  });

  it("asks for a review when the copy changed since it was approved", async () => {
    const h = await createLifecycleHarness({ changed: [pagePlugin("alpha")] });
    await h.launch();

    expect(readStoppedPlugin(h.lifecycle, "alpha")).toEqual({
      reason: { kind: "review" },
      action: "review",
    });
  });

  it("asks for a review when the launch scan refused the enabled Plugin", async () => {
    const h = await createLifecycleHarness({ refusedAtScan: [invalidManifestFolder("alpha")] });
    await h.launch();

    expect(h.lifecycle.state("alpha")).toBeNull();
    expect(readStoppedPlugin(h.lifecycle, "alpha")).toEqual({
      reason: { kind: "refusal", startupError: "manifest-invalid" },
      action: "review",
    });
  });

  it("is stopped by a refusal a previous launch recorded, until the Plugin next starts", async () => {
    const h = await createLifecycleHarness({
      approved: [pagePlugin("alpha", { lifecycle: "on-demand" })],
    });
    const approval = getPluginApproval("alpha");
    if (!approval) throw new Error("fixture approval missing");
    savePluginApproval({ ...approval, startupError: "worker-error message" });
    await h.launch();

    expect(readStoppedPlugin(h.lifecycle, "alpha")).toEqual({
      reason: { kind: "refusal", startupError: "worker-error message" },
      action: "tryAgain",
    });

    await h.lifecycle.start("alpha", "restart");
    await advanceUntil(() => h.lifecycle.state("alpha")?.status === "ready", "ready");

    expect(readStoppedPlugin(h.lifecycle, "alpha")).toBeNull();
    // A clean start clears the recorded error, so the next launch starts unmarked.
    expect(getPluginApproval("alpha")?.startupError).toBeUndefined();
  });

  it("does not carry a startup that ran out of time into the next launch", async () => {
    const h = await createLifecycleHarness({
      approved: [pagePlugin("alpha", { lifecycle: "on-demand" })],
    });
    const approval = getPluginApproval("alpha");
    if (!approval) throw new Error("fixture approval missing");
    savePluginApproval({ ...approval, startupError: "startup-timeout" });
    await h.launch();

    expect(readStoppedPlugin(h.lifecycle, "alpha")).toBeNull();
  });

  it("is nothing for an id the lifecycle has never seen", async () => {
    const h = await createLifecycleHarness();
    await h.launch();
    expect(readStoppedPlugin(h.lifecycle, "ghost")).toBeNull();
    expect(readStoppedPlugin(null, "ghost")).toBeNull();
  });
});

describe("readStoppedPlugin: when the mark clears", () => {
  it("clears when Try again brings the Plugin to ready", async () => {
    const h = await createLifecycleHarness({
      approved: [pagePlugin("alpha", { lifecycle: "on-demand" })],
    });
    await h.launch();
    await h.lifecycle.start("alpha", "restart");
    await advanceUntil(() => h.lifecycle.state("alpha")?.status === "ready", "ready");
    h.framesFor("alpha")[0].signalError("boom");
    await advanceUntil(() => h.lifecycle.state("alpha")?.status === "stopped", "the crash");
    expect(readStoppedPlugin(h.lifecycle, "alpha")).not.toBeNull();

    void h.lifecycle.start("alpha", "restart");
    await advanceUntil(() => h.lifecycle.state("alpha")?.status === "ready", "ready again");

    expect(readStoppedPlugin(h.lifecycle, "alpha")).toBeNull();
  });

  it("clears when the author disables the Plugin", async () => {
    const h = await createLifecycleHarness({ approved: [pagePlugin("alpha")] });
    await h.launch();
    h.framesFor("alpha")[0].signalError("boom");
    await advanceUntil(() => h.lifecycle.state("alpha")?.status === "stopped", "the crash");

    const approval = getPluginApproval("alpha");
    if (!approval) throw new Error("fixture approval missing");
    savePluginApproval({ ...approval, enabled: false });
    h.lifecycle.uninstall("alpha");

    expect(readStoppedPlugin(h.lifecycle, "alpha")).toBeNull();
  });

  it("clears a launch-scan refusal when the author disables the Plugin", async () => {
    const h = await createLifecycleHarness({ refusedAtScan: [invalidManifestFolder("alpha")] });
    await h.launch();
    expect(readStoppedPlugin(h.lifecycle, "alpha")).not.toBeNull();

    h.lifecycle.uninstall("alpha");

    expect(readStoppedPlugin(h.lifecycle, "alpha")).toBeNull();
  });

  it("does not refill the automatic restart: a Plugin that crashes after Try again stays stopped", async () => {
    const h = await createLifecycleHarness({ approved: [pagePlugin("alpha")] });
    await h.launch();
    h.framesFor("alpha")[0].signalError("boom");
    await advance(RESTART_DELAY_MS);
    await advanceUntil(() => h.framesFor("alpha").length === 2, "the automatic restart");
    await advanceUntil(() => h.lifecycle.state("alpha")?.status === "ready", "ready");
    h.framesFor("alpha")[1].signalError("boom");
    await advanceUntil(() => h.lifecycle.state("alpha")?.status === "stopped", "the crash");

    void h.lifecycle.start("alpha", "restart");
    await advanceUntil(() => h.lifecycle.state("alpha")?.status === "ready", "Try again");
    h.framesFor("alpha")[2].signalError("boom");
    await advance(RESTART_DELAY_MS * 2);

    expect(h.framesFor("alpha")).toHaveLength(3);
    expect(readStoppedPlugin(h.lifecycle, "alpha")).toMatchObject({
      reason: { kind: "limit", reason: "crashed" },
    });
  });
});

describe("the sidebar entry of a Plugin refused at the launch scan", () => {
  it("keeps the entry the last launch saved, and saves it again for the next launch", async () => {
    writePluginSidebarSnapshot([savedEntry("alpha"), savedEntry("gone")]);
    const h = await createLifecycleHarness({ refusedAtScan: [invalidManifestFolder("alpha")] });
    seedPluginSidebarFromSnapshot();
    await h.launch();

    expect(getPluginSidebarEntries().map((entry) => entry.pluginId)).toEqual(["alpha"]);
    expect(readPluginSidebarSnapshot().map((entry) => entry.pluginId)).toEqual(["alpha"]);
  });

  it("drops the kept entry once the author disables the Plugin", async () => {
    writePluginSidebarSnapshot([savedEntry("alpha")]);
    const h = await createLifecycleHarness({ refusedAtScan: [invalidManifestFolder("alpha")] });
    seedPluginSidebarFromSnapshot();
    await h.launch();

    h.lifecycle.uninstall("alpha");

    expect(getPluginSidebarEntries()).toEqual([]);
    expect(localStorage.getItem(PLUGIN_SIDEBAR_SNAPSHOT_KEY)).not.toContain('"alpha"');
  });

  it("gives nothing to a refused Plugin that never had an entry", async () => {
    const h = await createLifecycleHarness({ refusedAtScan: [invalidManifestFolder("alpha")] });
    seedPluginSidebarFromSnapshot();
    await h.launch();

    expect(getPluginSidebarEntries()).toEqual([]);
  });
});
