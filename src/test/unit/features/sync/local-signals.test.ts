import { describe, expect, it, vi } from "vitest";
import {
  emitChange,
  onChange,
  resetChangeFeedForTests,
  STORE_VIEW,
} from "@/features/sync/change-feed";
import {
  flushForOutsideWrite,
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

describe("flush before an outside write", () => {
  it("flushes open editors for a local write from outside a store", async () => {
    const flush = vi.fn();
    const off = registerPendingEditsFlush(flush);

    try {
      await flushForOutsideWrite("local");
    } finally {
      off();
    }

    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("does not flush for a store's own write or a remote write", async () => {
    const flush = vi.fn();
    const off = registerPendingEditsFlush(flush);

    try {
      await flushForOutsideWrite("local", STORE_VIEW);
      await flushForOutsideWrite("remote");
    } finally {
      off();
    }

    expect(flush).not.toHaveBeenCalled();
  });

  it("rejects before anything is written when a flush fails", async () => {
    const off = registerPendingEditsFlush(() => Promise.reject(new Error("disk full")));

    try {
      await expect(flushForOutsideWrite("local")).rejects.toBeInstanceOf(PendingEditsFlushError);
    } finally {
      off();
    }
  });
});
