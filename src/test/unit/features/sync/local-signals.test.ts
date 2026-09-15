import { describe, expect, it, vi } from "vitest";
import { emitChange, onChange, resetChangeFeedForTests } from "@/features/sync/change-feed";
import {
  flushPendingEdits,
  PendingEditsFlushError,
  registerPendingEditsFlush,
} from "@/features/sync/pending-edits";

describe("change feed", () => {
  it("notifies subscribers until they unsubscribe", async () => {
    resetChangeFeedForTests();
    const listener = vi.fn();
    const off = onChange(listener);

    await emitChange({ entity: "book", id: "b1", origin: "local", kind: "content" });
    off();
    await emitChange({ entity: "book", id: "b1", origin: "local", kind: "content" });

    expect(listener).toHaveBeenCalledTimes(1);
    resetChangeFeedForTests();
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

  it("flushes every editor, then rejects when one save failed", async () => {
    const survivor = vi.fn();
    const offFailing = registerPendingEditsFlush(() => Promise.reject(new Error("disk full")));
    const offSurvivor = registerPendingEditsFlush(survivor);

    try {
      await expect(flushPendingEdits()).rejects.toBeInstanceOf(PendingEditsFlushError);
    } finally {
      offFailing();
      offSurvivor();
    }

    expect(survivor).toHaveBeenCalledTimes(1);
  });

  it("rejects when a flush throws synchronously", async () => {
    const off = registerPendingEditsFlush(() => {
      throw new Error("disk full");
    });

    try {
      await expect(flushPendingEdits()).rejects.toBeInstanceOf(PendingEditsFlushError);
    } finally {
      off();
    }
  });

  it("resolves when every save lands", async () => {
    const off = registerPendingEditsFlush(() => Promise.resolve());

    try {
      await expect(flushPendingEdits()).resolves.toBeUndefined();
    } finally {
      off();
    }
  });

  it("stops calling a flush after it unregisters", async () => {
    const flush = vi.fn();
    registerPendingEditsFlush(flush)();

    await flushPendingEdits();

    expect(flush).not.toHaveBeenCalled();
  });
});
