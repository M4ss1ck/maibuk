import { describe, it, expect } from "vitest";
import { createAsyncQueue } from "@/lib/async-queue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createAsyncQueue()", () => {
  it("resolves with the task result", async () => {
    const queue = createAsyncQueue();
    await expect(queue.enqueue(async () => 42)).resolves.toBe(42);
  });

  it("runs tasks in FIFO order", async () => {
    const queue = createAsyncQueue();
    const order: string[] = [];
    const gate = deferred<void>();

    const first = queue.enqueue(async () => {
      order.push("first-start");
      await gate.promise;
      order.push("first-end");
      return "first";
    });
    const second = queue.enqueue(async () => {
      order.push("second-start");
      return "second";
    });

    // Let both tasks register, then release the gate.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["first-start"]);
    gate.resolve();
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("propagates rejection to the caller and still runs later tasks", async () => {
    const queue = createAsyncQueue();
    const order: string[] = [];

    const failing = queue.enqueue(async () => {
      order.push("failing");
      throw new Error("boom");
    });
    const next = queue.enqueue(async () => {
      order.push("next");
      return "recovered";
    });

    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("recovered");
    expect(order).toEqual(["failing", "next"]);
  });

  it("recovers the chain after multiple consecutive rejections", async () => {
    const queue = createAsyncQueue();

    const first = queue.enqueue(async () => {
      throw new Error("one");
    });
    const second = queue.enqueue(async () => {
      throw new Error("two");
    });
    const third = queue.enqueue(async () => "three");

    await expect(first).rejects.toThrow("one");
    await expect(second).rejects.toThrow("two");
    await expect(third).resolves.toBe("three");
  });
});
