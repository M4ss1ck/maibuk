import { describe, expect, it, vi } from "vitest";
import { notifyLocalChange, onLocalChange } from "@/features/sync/local-changes";
import { flushPendingEdits, registerPendingEditsFlush } from "@/features/sync/pending-edits";

describe("local change signal", () => {
  it("notifies subscribers until they unsubscribe", () => {
    const listener = vi.fn();
    const off = onLocalChange(listener);

    notifyLocalChange();
    off();
    notifyLocalChange();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("pending edits flush", () => {
  it("waits for every registered save", async () => {
    const order: string[] = [];
    const offA = registerPendingEditsFlush(async () => {
      await Promise.resolve();
      order.push("a");
    });
    const offB = registerPendingEditsFlush(() => {
      order.push("b");
    });

    await flushPendingEdits();
    offA();
    offB();

    expect(order.sort()).toEqual(["a", "b"]);
  });

  it("keeps flushing the others when one save fails", async () => {
    const survivor = vi.fn();
    const offFailing = registerPendingEditsFlush(() => Promise.reject(new Error("disk full")));
    const offSurvivor = registerPendingEditsFlush(survivor);

    await expect(flushPendingEdits()).resolves.toBeUndefined();
    offFailing();
    offSurvivor();

    expect(survivor).toHaveBeenCalledTimes(1);
  });

  it("stops calling a flush after it unregisters", async () => {
    const flush = vi.fn();
    registerPendingEditsFlush(flush)();

    await flushPendingEdits();

    expect(flush).not.toHaveBeenCalled();
  });
});
