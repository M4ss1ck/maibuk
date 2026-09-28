import { describe, expect, it } from "vitest";
import { createLineMapper } from "@/lib/platform/web/dictation/moonshine-lines";

const line = (id: string, text: string, isComplete = false, ms = 0) => ({
  id,
  text,
  isComplete,
  lastTranscriptionLatencyMs: ms,
});

describe("createLineMapper()", () => {
  it("emits changing partials and one final per line", () => {
    const m = createLineMapper();
    m.onTextChanged(line("1", "hola"));
    m.onTextChanged(line("1", "hola"));
    m.onTextChanged(line("1", "hola mun"));
    m.onCompleted(line("1", "hola mundo", true, 30));
    m.onCompleted(line("1", "hola mundo", true, 30));
    expect(m.drain()).toEqual([
      { type: "partial", text: "hola" },
      { type: "partial", text: "hola mun" },
      { type: "final", text: "hola mundo", latencyMs: 30 },
    ]);
    expect(m.drain()).toEqual([]);
  });

  it("drops empty lines and ignores text changes after completion", () => {
    const m = createLineMapper();
    m.onTextChanged(line("1", "  "));
    m.onCompleted(line("1", " ", true));
    m.onTextChanged(line("1", "late"));
    expect(m.drain()).toEqual([]);
  });

  it("trims whitespace Moonshine leaves around a line", () => {
    const m = createLineMapper();
    m.onCompleted(line("2", " It was the best of times. ", true, 12));
    expect(m.drain()).toEqual([
      { type: "final", text: "It was the best of times.", latencyMs: 12 },
    ]);
  });
});
