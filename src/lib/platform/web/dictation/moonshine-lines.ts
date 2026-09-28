// Moonshine reports one mutable line at a time until it completes; the
// protocol wants partials and immutable finals. Line ids stay in here.
import type { EngineEvent } from "@/lib/platform/web/dictation/speech-engine";

export interface MoonshineLine {
  id: string;
  text: string;
  isComplete: boolean;
  lastTranscriptionLatencyMs: number;
}

export function createLineMapper() {
  const out: EngineEvent[] = [];
  const finished = new Set<string>();
  let lastPartial = "";
  return {
    onTextChanged(line: MoonshineLine) {
      if (line.isComplete || finished.has(line.id)) return;
      const text = line.text.trim();
      if (!text || text === lastPartial) return;
      lastPartial = text;
      out.push({ type: "partial", text });
    },
    onCompleted(line: MoonshineLine) {
      if (finished.has(line.id)) return;
      finished.add(line.id);
      lastPartial = "";
      const text = line.text.trim();
      if (text)
        out.push({
          type: "final",
          text,
          latencyMs: line.lastTranscriptionLatencyMs,
        });
    },
    drain(): EngineEvent[] {
      return out.splice(0);
    },
  };
}
