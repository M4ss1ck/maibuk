import { describe, expect, it } from "vitest";
import fixture from "@/test/fixtures/dictation/protocol.json";
import { MODEL_CATALOG } from "@/features/dictation/catalog";
import {
  ERROR_CODES,
  type DictationErrorCode,
  type DictationEvent,
} from "@/features/dictation/types";
import type { HostMessage } from "@/lib/platform/tauri/dictation";

// The same JSON is read by src-tauri/src/dictation/protocol.rs tests. Typed
// literals here fail the typecheck when the TypeScript protocol changes; the
// Rust round-trip fails when the serde attributes drift from them.
const events: DictationEvent[] = [
  { type: "level", rms: 0.25 },
  { type: "partial", text: "hola" },
  { type: "final", text: "hola mundo", latencyMs: 40 },
  { type: "final", text: "sin latencia" },
  { type: "error", code: "mic_unavailable", detail: "unplugged" },
  { type: "error", code: "engine_crashed" },
];

const hostMessages: HostMessage[] = [
  { kind: "event", event: { type: "partial", text: "a" } },
  { kind: "stopped" },
];

const error: { code: DictationErrorCode; detail?: string } = {
  code: "model_corrupt",
  detail: "a.ort",
};

describe("protocol fixture shared with Rust", () => {
  it("holds a real catalog entry", () => {
    expect(fixture.spec).toEqual(MODEL_CATALOG[0]);
  });

  it("holds every event variant exactly as TypeScript types them", () => {
    expect(fixture.events).toEqual(events);
  });

  it("holds the host messages the Tauri host reads", () => {
    expect(fixture.hostMessages).toEqual(hostMessages);
  });

  it("holds a rejected command's error body", () => {
    expect(fixture.error).toEqual(error);
  });

  it("lists every error code, so Rust must know each one", () => {
    expect(fixture.errorCodes).toEqual([...ERROR_CODES]);
  });
});
