import { describe, expect, it, vi } from "vitest";
import { runShutdown, type ShutdownSteps } from "@/lib/window/shutdown";

function steps(overrides: Partial<ShutdownSteps> = {}): ShutdownSteps & { order: string[] } {
  const order: string[] = [];
  const record =
    (name: string) =>
    async (): Promise<void> => {
      order.push(name);
    };
  return {
    order,
    leaveTutorial: () => void order.push("tutorial"),
    flushEdits: record("flush"),
    settleBackgroundWork: record("settle"),
    flushMetrics: record("metrics"),
    exit: async () => void order.push("exit"),
    restart: async () => void order.push("restart"),
    settleLimitMs: 20,
    ...overrides,
  };
}

describe("runShutdown", () => {
  it("leaves the Tutorial, flushes edits, settles Backup and Sync, flushes metrics, then exits", async () => {
    const s = steps();
    await runShutdown("exit", s);
    expect(s.order).toEqual(["tutorial", "flush", "settle", "metrics", "exit"]);
  });

  it("restarts instead of exiting in restart mode", async () => {
    const s = steps();
    await runShutdown("restart", s);
    expect(s.order).toEqual(["tutorial", "flush", "settle", "metrics", "restart"]);
  });

  it("still exits when a running Backup never settles", async () => {
    const s = steps({ settleBackgroundWork: () => new Promise<void>(() => {}) });
    await runShutdown("exit", s);
    expect(s.order).toContain("exit");
    expect(s.order).toContain("metrics");
  });

  it("exits on close even when an edit cannot be saved", async () => {
    const s = steps({ flushEdits: async () => Promise.reject(new Error("disk full")) });
    await runShutdown("exit", s);
    expect(s.order).toContain("exit");
  });

  it("does not restart when an edit cannot be saved, so the author keeps the unsaved text", async () => {
    const s = steps({ flushEdits: async () => Promise.reject(new Error("disk full")) });
    await expect(runShutdown("restart", s)).rejects.toThrow("disk full");
    expect(s.order).not.toContain("restart");
    expect(s.order).not.toContain("exit");
  });

  it("exits even when flushing metrics fails", async () => {
    const s = steps({ flushMetrics: vi.fn().mockRejectedValue(new Error("offline")) });
    await runShutdown("exit", s);
    expect(s.order).toContain("exit");
  });
});
