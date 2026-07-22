import { expect, it, vi } from "vitest";
import type { WorkerRequest, WorkerResponse } from "@/lib/metrics/types";

vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  IS_ANDROID: true,
}));

import { createMetricsService } from "@/lib/metrics/MetricsService";

class ReadyWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;

  postMessage(message: WorkerRequest): void {
    if (message.type === "init") {
      this.onmessage?.({ data: { type: "ready", id: message.id } } as MessageEvent<WorkerResponse>);
    }
  }

  terminate(): void {}
}

it("keeps beforeunload but leaves Android visibility handling to the lifecycle owner", async () => {
  const addWindowListener = vi.spyOn(window, "addEventListener");
  const addDocumentListener = vi.spyOn(document, "addEventListener");
  const service = createMetricsService({
    createWorker: () => new ReadyWorker() as unknown as Worker,
    getDeviceId: () => "device-1",
  });

  await service.init();

  expect(addWindowListener).toHaveBeenCalledWith("beforeunload", expect.any(Function));
  expect(addDocumentListener).not.toHaveBeenCalledWith("visibilitychange", expect.any(Function));

  service.shutdown();
  addWindowListener.mockRestore();
  addDocumentListener.mockRestore();
});
