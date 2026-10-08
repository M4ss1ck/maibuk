// Dictation's shared vocabulary. Nothing here knows an engine or a platform:
// engines hide behind SpeechEngine inside each backend, backends behind
// RecognizerHost, and models are data (ModelSpec).
import type { Language } from "@/features/settings/types";

export type DictationLanguage = Language;
export type EngineId = "moonshine";
export type ModelTier = "fast" | "accurate";
/** How much of the Dictation Bar an editor screen shows. */
export const DICTATION_BAR_SIZES = ["hidden", "compact", "full"] as const;
export type DictationBarSize = (typeof DICTATION_BAR_SIZES)[number];
export type DictationPlatform = "web" | "tauri-linux";

export interface ModelFile {
  name: string;
  url: string;
  bytes: number;
  /** CRC32C (Castagnoli) as base64 of the 4 big-endian bytes. */
  checksum: { algo: "crc32c"; value: string };
}

export interface ModelSpec {
  /** Changes whenever the file set changes, so stale installs never load. */
  id: string;
  engine: EngineId;
  languages: DictationLanguage[];
  tier: ModelTier;
  platforms: DictationPlatform[];
  files: ModelFile[];
  /** Passed to the engine verbatim; only the engine adapter reads them. */
  engineOptions: Record<string, string>;
  /** What the model's text already has; the future interpreter reads this. */
  capabilities: { casing: boolean; punctuation: boolean; streaming: boolean };
}

export const ERROR_CODES = [
  "mic_denied",
  "mic_unavailable",
  "model_missing",
  "model_corrupt",
  "download_failed",
  "disk_full",
  "model_gone",
  "engine_crashed",
  "unsupported",
  "tutorial_active",
  "no_target",
  "cancelled",
] as const;

export type DictationErrorCode = (typeof ERROR_CODES)[number];

export class DictationError extends Error {
  constructor(
    readonly code: DictationErrorCode,
    detail?: string
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "DictationError";
  }
}

export function toDictationError(error: unknown, fallback: DictationErrorCode): DictationError {
  if (error instanceof DictationError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && isErrorCode(code)) return new DictationError(code);
  return new DictationError(fallback, error instanceof Error ? error.message : String(error));
}

function isErrorCode(value: string): value is DictationErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value);
}

/** The RecognizerHost protocol's events, identical on every backend. */
export type DictationEvent =
  | { type: "level"; rms: number }
  | { type: "partial"; text: string }
  | { type: "final"; text: string; latencyMs?: number }
  | { type: "error"; code: DictationErrorCode; detail?: string };

export type UnsupportedReason = "platform" | "not_isolated" | "no_audio" | "library_missing";

export interface SupportReport {
  supported: boolean;
  reason?: UnsupportedReason;
}

/**
 * One backend: captures audio, runs a SpeechEngine, reports DictationEvents.
 * Contract (conformance-tested): partials precede their final; a final never
 * changes; stop() resolves after the final for speech so far; no events after
 * stop() resolves.
 */
export interface RecognizerHost {
  isSupported(): Promise<SupportReport>;
  /** Loads an installed model; rejects with DictationError("model_corrupt") on bad files. */
  load(spec: ModelSpec): Promise<void>;
  start(listener: (event: DictationEvent) => void): Promise<void>;
  stop(): Promise<void>;
  setContext(text: string): Promise<void>;
  /** The microphone the backend will use, when it can name it (desktop); null otherwise. */
  inputDevice(): Promise<string | null>;
  dispose(): Promise<void>;
}

/** Where installed model files live; each platform verifies what it writes. */
export interface ModelFiles {
  /** Downloads, verifies every file's size and CRC32C, then marks complete. */
  install(
    spec: ModelSpec,
    onProgress: (done: number, total: number) => void,
    signal: AbortSignal
  ): Promise<void>;
  isComplete(spec: ModelSpec): Promise<boolean>;
  remove(id: string): Promise<void>;
}
