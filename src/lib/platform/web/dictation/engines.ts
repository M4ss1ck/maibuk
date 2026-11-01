import { DictationError, type ModelSpec } from "@/features/dictation/types";
import { createMoonshineEngine } from "@/lib/platform/web/dictation/moonshine-engine";
import type { SpeechEngine } from "@/lib/platform/web/dictation/speech-engine";

// Adding an engine: one factory here, one in src-tauri/src/dictation/engine/mod.rs.
// sherpa-onnx has no browser build (issue #663): its models are tauri-linux only.
const ENGINES: Record<ModelSpec["engine"], () => SpeechEngine> = {
  moonshine: createMoonshineEngine,
  sherpa: () => {
    throw new DictationError("unsupported", "sherpa runs on desktop only");
  },
};

export function createEngine(spec: ModelSpec): SpeechEngine {
  return ENGINES[spec.engine]();
}
