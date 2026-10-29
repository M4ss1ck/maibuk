import { afterEach, describe, expect, it, vi } from "vitest";
import { planPluginModules } from "@/features/plugins/modules";
import { computePluginModulePlan } from "@/features/plugins/module-plan";
import type { PluginModulePlanRequest } from "@/features/plugins/module-plan";
import type { PluginFolderFile } from "@/features/plugins/types";
import { sourceFolder } from "@/test/support/plugin-fixtures";

class DataCloneError extends Error {
  constructor() {
    super("The object could not be cloned.");
    this.name = "DataCloneError";
  }
}

type Behavior =
  | "plan"
  | "worker-error"
  | "worker-error-event"
  | "unexpected-message"
  | "error-reply"
  | "message-error";

// Protocol-correct fake: it receives a structured clone of the request (as a
// real Worker does), runs the real computePluginModulePlan on it, and replies
// asynchronously. Each behavior drives one failure path in modules.ts.
class FakeModuleWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event | string) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  posted: unknown[][] = [];
  terminated = false;
  postError: Error | null = null;
  private readonly behavior: Behavior;

  constructor(behavior: Behavior) {
    this.behavior = behavior;
  }

  postMessage(...args: unknown[]): void {
    this.posted.push(args);
    if (this.postError) throw this.postError;
    const request = structuredClone(args[0]) as PluginModulePlanRequest;
    setTimeout(() => void this.respond(request), 0);
  }

  terminate(): void {
    this.terminated = true;
  }

  private async respond(request: PluginModulePlanRequest): Promise<void> {
    switch (this.behavior) {
      case "plan": {
        const plan = await computePluginModulePlan(request.files, request.entry);
        this.onmessage?.({ data: { type: "result", plan: structuredClone(plan) } } as MessageEvent);
        return;
      }
      case "worker-error":
        this.onerror?.(new Event("error"));
        return;
      case "worker-error-event":
        this.onerror?.(new ErrorEvent("error", { message: "SyntaxError in modules.worker" }));
        return;
      case "unexpected-message":
        this.onmessage?.({ data: { type: "ack" } } as MessageEvent);
        return;
      case "error-reply":
        this.onmessage?.({
          data: { type: "error", message: "Unexpected token in index.js" },
        } as MessageEvent);
        return;
      case "message-error":
        this.onmessageerror?.({} as MessageEvent);
        return;
    }
  }
}

const OK_SOURCE = {
  "index.js": 'import { a } from "./lib/util.js";\nexport const b = a;',
  "lib/util.js": "export const a = 1;",
};

function run(behavior: Behavior, files: PluginFolderFile[] = sourceFolder(OK_SOURCE).files) {
  const worker = new FakeModuleWorker(behavior);
  const promise = planPluginModules(files, "index.js", {
    createWorker: () => worker as unknown as Worker,
  });
  return { worker, promise };
}

describe("planPluginModules() through the module Worker", () => {
  it("relays the plan the Worker computed for an ok folder", async () => {
    const files = sourceFolder(OK_SOURCE).files;
    const { promise } = run("plan", files);

    const result = await promise;
    expect(result).toEqual(await computePluginModulePlan(files, "index.js"));
    if (!result.ok) throw new Error("expected a plan");
    expect(result.modules.map((module) => module.path)).toEqual(["lib/util.js", "index.js"]);
  });

  it("terminates the Worker after a successful reply", async () => {
    const { worker, promise } = run("plan");
    await promise;
    expect(worker.terminated).toBe(true);
  });

  it("relays ok:false problems from the Worker and terminates it", async () => {
    const { worker, promise } = run(
      "plan",
      sourceFolder({ "index.js": 'import x from "left-pad";' }).files
    );

    const result = await promise;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.problems.map((problem) => problem.code)).toEqual(["bare-import"]);
    expect(worker.terminated).toBe(true);
  });

  it("rejects and terminates on a Worker error, without falling back to the main thread", async () => {
    const { worker, promise } = run("worker-error");

    await expect(promise).rejects.toThrow("plugin module-plan worker failed: worker error");
    expect(worker.terminated).toBe(true);
  });

  it("keeps a real ErrorEvent's message in the rejection", async () => {
    const { worker, promise } = run("worker-error-event");

    await expect(promise).rejects.toThrow(
      "plugin module-plan worker failed: SyntaxError in modules.worker"
    );
    expect(worker.terminated).toBe(true);
  });

  it("rejects and terminates on an unexpected message", async () => {
    const { worker, promise } = run("unexpected-message");

    await expect(promise).rejects.toThrow("Unexpected message from plugin module-plan worker");
    expect(worker.terminated).toBe(true);
  });

  it("rejects with the Worker's message on an error reply", async () => {
    const { worker, promise } = run("error-reply");

    await expect(promise).rejects.toThrow(
      "Plugin module planning failed: Unexpected token in index.js"
    );
    expect(worker.terminated).toBe(true);
  });

  it("rejects and terminates when a reply fails to deserialize", async () => {
    const { worker, promise } = run("message-error");

    await expect(promise).rejects.toThrow(
      "plugin module-plan worker message failed to deserialize"
    );
    expect(worker.terminated).toBe(true);
  });

  it("rejects and terminates when postMessage throws", async () => {
    const worker = new FakeModuleWorker("plan");
    worker.postError = new DataCloneError();
    const promise = planPluginModules(sourceFolder(OK_SOURCE).files, "index.js", {
      createWorker: () => worker as unknown as Worker,
    });

    await expect(promise).rejects.toThrow("could not be cloned");
    expect(worker.terminated).toBe(true);
  });

  it("copies the file bytes: the caller's bytes stay readable and nothing is transferred", async () => {
    const files = sourceFolder(OK_SOURCE).files;
    const original = files[0].bytes;
    const { worker, promise } = run("plan", files);

    await promise;
    expect(files[0].bytes.byteLength).toBeGreaterThan(0);
    expect(new TextDecoder().decode(files[0].bytes)).toBe(OK_SOURCE["index.js"]);
    expect(files[0].bytes).toBe(original);

    expect(worker.posted).toHaveLength(1);
    // postMessage(message) with no transfer list: a single argument.
    expect(worker.posted[0]).toHaveLength(1);
    expect(worker.posted[0][0]).toMatchObject({ type: "plan", entry: "index.js" });
  });
});

// Drives the real Worker entry with a stubbed `self`, so the protocol the fake
// above speaks is pinned to what modules.worker.ts actually posts.
describe("modules.worker.ts entry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function loadWorker() {
    const scope = {
      postMessage: vi.fn(),
      onmessage: null as ((event: MessageEvent) => void) | null,
    };
    vi.stubGlobal("self", scope);
    vi.resetModules();
    await import("@/features/plugins/modules.worker");
    return scope;
  }

  it("replies with the plan for a plan request", async () => {
    const scope = await loadWorker();
    const files = sourceFolder(OK_SOURCE).files;
    scope.onmessage?.({ data: { type: "plan", files, entry: "index.js" } } as MessageEvent);

    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledTimes(1));
    expect(scope.postMessage).toHaveBeenCalledWith({
      type: "result",
      plan: await computePluginModulePlan(files, "index.js"),
    });
  });

  it("replies with an error to an unknown request instead of staying silent", async () => {
    const scope = await loadWorker();
    scope.onmessage?.({ data: { type: "ack" } } as MessageEvent);

    expect(scope.postMessage).toHaveBeenCalledWith({
      type: "error",
      message: "Unknown module-plan request",
    });
  });
});
