export interface LineStatsSummary {
  lines: number;
  medianLatencyMs: number | null;
  medianInterpreterMs: number | null;
  maxInterpreterMs: number | null;
  spokenPunctuationCount: number;
  scratchCount: number;
  voiceCommandCount: number;
  voiceCommandUnavailableCount: number;
  voiceCommandRefusedCount: number;
}

export interface LineStats {
  record(latencyMs: number | undefined): void;
  recordInterpreter(
    durationMs: number,
    spokenPunctuationCount: number,
    scratchCount?: number,
    voiceCommandCount?: number,
    unavailable?: number,
    refused?: number
  ): void;
  summary(): LineStatsSummary;
}

/**
 * Recent per-line engine latency and Dictation Command Interpreter timing,
 * shown in Settings → Dictation. Memory only: a Metrics event would sync to the
 * server. With an even count the median is the upper middle value, so it is
 * always a value that really happened.
 */
export function createLineStats(capacity = 50): LineStats {
  const recent: number[] = [];
  const recentInterpreter: number[] = [];
  let lines = 0;
  let spokenPunctuationCount = 0;
  let scratchCount = 0;
  let voiceCommands = 0;
  let voiceUnavailable = 0;
  let voiceRefused = 0;
  const upperMiddle = (samples: number[]): number | null => {
    if (samples.length === 0) return null;
    const sorted = [...samples].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  return {
    record(latencyMs) {
      lines += 1;
      if (latencyMs === undefined) return;
      recent.push(latencyMs);
      if (recent.length > capacity) recent.shift();
    },
    recordInterpreter(durationMs, spoken, scratch = 0, voice = 0, unavailable = 0, refused = 0) {
      spokenPunctuationCount += spoken;
      scratchCount += scratch;
      voiceCommands += voice;
      voiceUnavailable += unavailable;
      voiceRefused += refused;
      recentInterpreter.push(durationMs);
      if (recentInterpreter.length > capacity) recentInterpreter.shift();
    },
    summary() {
      return {
        lines,
        medianLatencyMs: upperMiddle(recent),
        medianInterpreterMs: upperMiddle(recentInterpreter),
        maxInterpreterMs: recentInterpreter.length === 0 ? null : Math.max(...recentInterpreter),
        spokenPunctuationCount,
        scratchCount,
        voiceCommandCount: voiceCommands,
        voiceCommandUnavailableCount: voiceUnavailable,
        voiceCommandRefusedCount: voiceRefused,
      };
    },
  };
}
