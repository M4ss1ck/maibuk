import type { ModelSpec } from "@/features/dictation/types";
import { createMoonshineEngine } from "@/lib/platform/web/dictation/moonshine-engine";
import type { SpeechEngine } from "@/lib/platform/web/dictation/speech-engine";

// Adding an engine: one factory here, one in src-tauri/src/dictation/engine/mod.rs.
const ENGINES: Record<ModelSpec["engine"], () => SpeechEngine> = {
  moonshine: createMoonshineEngine,
};

export function createEngine(spec: ModelSpec): SpeechEngine {
  return ENGINES[spec.engine]();
}
