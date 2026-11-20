// @vitest-environment jsdom
/**
 * The Timer core on its own: the behavior the page's suite cannot reach with a
 * page mounted. Storage that is not the shape `time.ts` writes must not leave a
 * broken Timer behind, and a zero-length Timer must not start or schedule an
 * Alert.
 */

import { describe, expect, it } from "vitest";
import { createTestHost } from "@/features/plugins/test-kit";
import { createPluginClient } from "@/plugin-sdk";
import { clockManifest } from "./test-support";
import { createTimer } from "./timer";

/** The default Timer a malformed or empty storage leaves in place. */
const DEFAULT_SNAPSHOT = {
  state: { status: "idle", length: 1_500_000 },
  recent: [],
};

describe("Clock Timer core", () => {
  it("falls back to the default Timer when storage is malformed", async () => {
    const values: unknown[] = [
      "nonsense",
      42,
      { state: { status: "running" } },
      { state: { status: "idle", length: -1 } },
      { state: { status: "paused", length: 1_000, remaining: "soon" } },
    ];

    for (const value of values) {
      const storage = new Map<string, unknown>([["timer", value]]);
      const host = createTestHost({ manifest: clockManifest(), storage });
      try {
        const timer = createTimer(createPluginClient(host.port));
        await timer.load();
        expect(timer.snapshot()).toEqual(DEFAULT_SNAPSHOT);
      } finally {
        await host.stop();
      }
    }
  });

  it("does not start a zero-length Timer and schedules no Alert", async () => {
    const storage = new Map<string, unknown>();
    const host = createTestHost({ manifest: clockManifest(), storage });
    try {
      const timer = createTimer(createPluginClient(host.port));
      await timer.load();
      timer.setLength(0);
      timer.start();

      expect(timer.snapshot()).toEqual({ state: { status: "idle", length: 0 }, recent: [] });
      expect(host.systemNotifications.scheduled.size).toBe(0);
    } finally {
      await host.stop();
    }
  });
});
