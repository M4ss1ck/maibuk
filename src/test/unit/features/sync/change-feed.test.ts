import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelBulkReplace,
  emitChange,
  isBulkSignal,
  isEntityChange,
  isLibraryAvailability,
  onBeforeBulkReplace,
  onBulkReplaceCancelled,
  onChange,
  prepareBulkReplace,
  resetChangeFeedForTests,
  STORE_VIEW,
  type Change,
  type ChangeFeedMeta,
  type ChangeFeedSignal,
} from "@/features/sync/change-feed";

const bookContent: Change = { entity: "book", id: "b1", origin: "local", kind: "content" };

afterEach(() => {
  resetChangeFeedForTests();
});

describe("change feed", () => {
  it("delivers changes to subscribers in subscription order", async () => {
    const order: string[] = [];
    const offA = onChange(() => {
      order.push("a");
    });
    const offB = onChange(async () => {
      await Promise.resolve();
      order.push("b");
    });
    try {
      await emitChange(bookContent);
    } finally {
      offA();
      offB();
    }

    expect(order).toEqual(["a", "b"]);
  });

  it("awaits async subscribers before resolving", async () => {
    const refreshed: string[] = [];
    const events: string[] = [];
    let subscriberStarted = false;
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const off = onChange(async (signal) => {
      subscriberStarted = true;
      await gate;
      if (isEntityChange(signal)) refreshed.push(signal.id);
      events.push("subscriber-done");
    });
    try {
      const emitted = emitChange(bookContent);
      await vi.waitFor(() => expect(subscriberStarted).toBe(true));
      openGate();
      await emitted;
      events.push("emit-resolved");
    } finally {
      off();
    }

    expect(refreshed).toEqual(["b1"]);
    // emit resolves only after the subscriber's refresh finished.
    expect(events).toEqual(["subscriber-done", "emit-resolved"]);
  });

  it("isolates a failing listener: others still run and emit never rejects", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const survivor = vi.fn();
    const offFailing = onChange(() => Promise.reject(new Error("subscriber blew up")));
    const offThrowing = onChange(() => {
      throw new Error("sync throw");
    });
    const offSurvivor = onChange(survivor);
    try {
      await expect(emitChange(bookContent)).resolves.toBeUndefined();

      expect(survivor).toHaveBeenCalledTimes(1);
      expect(survivor).toHaveBeenCalledWith(bookContent, undefined);
      expect(error).toHaveBeenCalled();
    } finally {
      offFailing();
      offThrowing();
      offSurvivor();
      error.mockRestore();
    }
  });

  it("stops calling a subscriber after it unsubscribes", async () => {
    const listener = vi.fn();
    const off = onChange(listener);
    off();

    await emitChange(bookContent);

    expect(listener).not.toHaveBeenCalled();
  });

  it("passes origin and kind through untouched", async () => {
    const seen: Change[] = [];
    const off = onChange((signal) => {
      if (isEntityChange(signal)) seen.push(signal);
    });
    try {
      await emitChange({ entity: "note", id: "n1", origin: "remote", kind: "metadata" });
    } finally {
      off();
    }

    expect(seen).toEqual([{ entity: "note", id: "n1", origin: "remote", kind: "metadata" }]);
  });

  it("carries a completed bulk operation on the same stream", async () => {
    const seen: ChangeFeedSignal[] = [];
    const off = onChange((signal) => {
      seen.push(signal);
    });
    try {
      await emitChange({ scope: "all", reason: "restore" });
      await emitChange({ scope: "all", reason: "resetLibrary" });
      await emitChange({ scope: "all", reason: "databaseLoad" });
    } finally {
      off();
    }

    expect(seen).toEqual([
      { scope: "all", reason: "restore" },
      { scope: "all", reason: "resetLibrary" },
      { scope: "all", reason: "databaseLoad" },
    ]);
    expect(seen.every(isBulkSignal)).toBe(true);
  });

  it("carries Library availability around the Tutorial on the same stream", async () => {
    const seen: ChangeFeedSignal[] = [];
    const off = onChange((signal) => {
      seen.push(signal);
    });
    try {
      await emitChange({ available: false, reason: "tutorial" });
      await emitChange({ available: true, reason: "tutorial" });
    } finally {
      off();
    }

    expect(seen).toEqual([
      { available: false, reason: "tutorial" },
      { available: true, reason: "tutorial" },
    ]);
    expect(seen.every(isLibraryAvailability)).toBe(true);
  });

  it("awaits async subscribers of bulk and availability signals too", async () => {
    const order: string[] = [];
    const off = onChange(async (signal) => {
      await Promise.resolve();
      if (isBulkSignal(signal)) order.push(signal.reason);
      if (isLibraryAvailability(signal)) order.push(String(signal.available));
    });
    try {
      await emitChange({ scope: "all", reason: "databaseLoad" });
      await emitChange({ available: true, reason: "tutorial" });
    } finally {
      off();
    }

    expect(order).toEqual(["databaseLoad", "true"]);
  });

  it("carries the store-view meta to listeners and omits it for outside writers", async () => {
    const seen: Array<{ signal: ChangeFeedSignal; meta: ChangeFeedMeta | undefined }> = [];
    const off = onChange((signal, meta) => {
      seen.push({ signal, meta });
    });
    try {
      await emitChange({ entity: "book", id: "b1", origin: "local", kind: "content" }, STORE_VIEW);
      await emitChange({ entity: "book", id: "b1", origin: "local", kind: "content" });
    } finally {
      off();
    }

    expect(seen[0].meta).toEqual({ viewUpdated: true });
    expect(seen[1].meta).toBeUndefined();
  });

  it("the guards accept only their own signal shape", () => {
    const change: ChangeFeedSignal = {
      entity: "book",
      id: "b1",
      origin: "local",
      kind: "content",
    };
    const bulk: ChangeFeedSignal = { scope: "all", reason: "restore" };
    const availability: ChangeFeedSignal = { available: false, reason: "tutorial" };

    expect(isEntityChange(change)).toBe(true);
    expect(isBulkSignal(change)).toBe(false);
    expect(isLibraryAvailability(change)).toBe(false);
    expect(isEntityChange(bulk)).toBe(false);
    expect(isBulkSignal(bulk)).toBe(true);
    expect(isLibraryAvailability(bulk)).toBe(false);
    expect(isEntityChange(availability)).toBe(false);
    expect(isBulkSignal(availability)).toBe(false);
    expect(isLibraryAvailability(availability)).toBe(true);
  });
});

describe("before-bulk-replace seam", () => {
  it("awaits every handler in subscription order before prepareBulkReplace resolves", async () => {
    const order: string[] = [];
    const offA = onBeforeBulkReplace(async (reason) => {
      await Promise.resolve();
      order.push(`a:${reason}`);
    });
    const offB = onBeforeBulkReplace((reason) => {
      order.push(`b:${reason}`);
    });
    try {
      await prepareBulkReplace("restore");
    } finally {
      offA();
      offB();
    }

    expect(order).toEqual(["a:restore", "b:restore"]);
  });

  it("isolates a failing handler: others still run and prepare never rejects", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const survivor = vi.fn();
    const offThrowing = onBeforeBulkReplace(() => {
      throw new Error("sync throw");
    });
    const offRejecting = onBeforeBulkReplace(() => Promise.reject(new Error("async throw")));
    const offSurvivor = onBeforeBulkReplace(survivor);
    try {
      await expect(prepareBulkReplace("resetLibrary")).resolves.toBeUndefined();

      expect(survivor).toHaveBeenCalledTimes(1);
      expect(survivor).toHaveBeenCalledWith("resetLibrary");
      expect(error).toHaveBeenCalled();
    } finally {
      offThrowing();
      offRejecting();
      offSurvivor();
      error.mockRestore();
    }
  });

  it("stops calling a handler after it unsubscribes", async () => {
    const handler = vi.fn();
    const off = onBeforeBulkReplace(handler);
    off();

    await prepareBulkReplace("databaseLoad");

    expect(handler).not.toHaveBeenCalled();
  });

  it("routes an abandoned replacement to the cancel handlers", async () => {
    const prepared = vi.fn();
    const cancelled = vi.fn();
    const offPrepared = onBeforeBulkReplace(prepared);
    const offCancelled = onBulkReplaceCancelled(cancelled);
    try {
      await prepareBulkReplace("restore");
      await cancelBulkReplace("restore");
    } finally {
      offPrepared();
      offCancelled();
    }

    expect(prepared).toHaveBeenCalledWith("restore");
    expect(prepared).toHaveBeenCalledTimes(1);
    expect(cancelled).toHaveBeenCalledWith("restore");
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it("stops calling a cancel handler after it unsubscribes", async () => {
    const handler = vi.fn();
    const off = onBulkReplaceCancelled(handler);
    off();

    await cancelBulkReplace("databaseLoad");

    expect(handler).not.toHaveBeenCalled();
  });
});
