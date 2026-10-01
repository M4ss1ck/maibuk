// The swap point. One implementation per engine per backend; nothing above the worker sees it.
import type { DictationEvent, ModelSpec } from "@/features/dictation/types";

export type EngineEvent = Extract<DictationEvent, { type: "partial" | "final" }>;

export interface SpeechEngine {
  load(files: Map<string, Uint8Array>, spec: ModelSpec): Promise<void>;
  start(): void; // begins a fresh stream for one Dictation Session
  accept(pcm16k: Float32Array): void;
  poll(): EngineEvent[];
  finish(): EngineEvent[]; // completes the active line; no events after
  setContext(text: string): void;
  dispose(): void;
}
