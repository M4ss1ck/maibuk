/**
 * FIFO serialization queue for async work.
 *
 * Each enqueued task runs only after the previously enqueued task settles,
 * in enqueue order. Rejections propagate to the enqueuing caller without
 * breaking the chain — later tasks still run.
 */
export interface AsyncQueue {
  enqueue<T>(task: () => Promise<T>): Promise<T>;
}

export function createAsyncQueue(): AsyncQueue {
  let tail: Promise<void> = Promise.resolve();

  return {
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task, task);
      tail = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    },
  };
}
