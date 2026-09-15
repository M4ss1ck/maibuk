import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emitChange,
  onChange,
  resetChangeFeedForTests,
  type Change,
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
    const off = onChange(async (change) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      refreshed.push(change.id);
    });
    try {
      await emitChange(bookContent);
    } finally {
      off();
    }

    expect(refreshed).toEqual(["b1"]);
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
      expect(survivor).toHaveBeenCalledWith(bookContent);
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
    const off = onChange((change) => {
      seen.push(change);
    });
    try {
      await emitChange({ entity: "note", id: "n1", origin: "remote", kind: "metadata" });
    } finally {
      off();
    }

    expect(seen).toEqual([{ entity: "note", id: "n1", origin: "remote", kind: "metadata" }]);
  });
});
