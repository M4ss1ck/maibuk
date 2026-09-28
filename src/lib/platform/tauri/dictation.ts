import { Channel, invoke } from "@tauri-apps/api/core";
import {
  toDictationError,
  type DictationEvent,
  type ModelFiles,
  type ModelSpec,
  type RecognizerHost,
  type SupportReport,
} from "@/features/dictation/types";

type HostMessage =
  | { kind: "event"; event: DictationEvent }
  | { kind: "stopped" };

async function call<T = void>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toDictationError(error, "engine_crashed");
  }
}

export function createTauriRecognizerHost(): RecognizerHost {
  let stopped: (() => void) | null = null;
  // Whether a start() completed and no stop() consumed it yet. A stop before
  // start (or after a failed start) has no runner to wait for.
  let active = false;
  // The runner can end by itself (mic lost, engine error): its `stopped`
  // then arrives before stop() is called, and stop() must not wait for another.
  let ended = false;
  return {
    isSupported: () => call<SupportReport>("dictation_is_supported"),
    load: (spec: ModelSpec) => call("dictation_load", { spec }),
    async start(listener) {
      ended = false;
      const channel = new Channel<HostMessage>();
      channel.onmessage = (message) => {
        if (message.kind === "event") return listener(message.event);
        if (stopped) {
          stopped();
          stopped = null;
        } else ended = true;
      };
      await call("dictation_start", { onEvent: channel });
      active = true;
    },
    async stop() {
      if (!active && !ended) {
        await call("dictation_stop");
        active = false;
        return;
      }
      if (ended) {
        ended = false;
        await call("dictation_stop");
        active = false;
        return;
      }
      // Channel messages can arrive after the command resolves; the Rust side
      // sends `stopped` after the last final, so wait for it.
      const done = new Promise<void>((resolve) => (stopped = resolve));
      await call("dictation_stop");
      await done;
      active = false;
    },
    setContext: (text) => call("dictation_set_context", { text }),
    inputDevice: () => call<string | null>("dictation_input_device"),
    dispose: () => call("dictation_unload"),
  };
}

export const tauriModelFiles: ModelFiles = {
  async install(spec, onProgress, signal) {
    if (signal.aborted) {
      throw toDictationError({ code: "cancelled" }, "cancelled");
    }
    const channel = new Channel<[number, number]>();
    channel.onmessage = ([done, total]) => onProgress(done, total);
    const cancel = () =>
      void invoke("dictation_models_cancel", { id: spec.id });
    signal.addEventListener("abort", cancel, { once: true });
    try {
      await call("dictation_models_install", { spec, onProgress: channel });
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  },
  isComplete: (spec) => call<boolean>("dictation_models_is_complete", { spec }),
  remove: (id) => call("dictation_models_remove", { id }),
};
