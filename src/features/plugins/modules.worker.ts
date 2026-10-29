import { computePluginModulePlan } from "@/features/plugins/module-plan";
import type {
  PluginModulePlanRequest,
  PluginModulePlanResponse,
} from "@/features/plugins/module-plan";

// One-shot module Worker: runs es-module-lexer for a single Plugin folder and
// replies once. The main thread terminates it after the reply, which frees the
// lexer's WebAssembly memory. A failure is posted back as `error` so the
// caller rejects with the message instead of waiting on a dead Worker.
const scope = self as unknown as {
  postMessage(message: PluginModulePlanResponse): void;
  onmessage: ((event: MessageEvent<PluginModulePlanRequest>) => void) | null;
};

scope.onmessage = (event: MessageEvent<PluginModulePlanRequest>) => {
  const message = event.data;
  // An unknown request gets an error reply, so the caller never waits on a
  // message the Worker ignored.
  if (message?.type !== "plan") {
    scope.postMessage({ type: "error", message: "Unknown module-plan request" });
    return;
  }

  computePluginModulePlan(message.files, message.entry).then(
    (plan) => scope.postMessage({ type: "result", plan }),
    (error: unknown) =>
      scope.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      })
  );
};
