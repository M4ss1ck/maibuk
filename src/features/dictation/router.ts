// Every finished line passes through this seam before reaching an editor.
// The Interpreter produces text, layout, list, and opener edits, or one Voice
// Command, or a scratch request.
import type { VoiceCommandRun } from "@/features/dictation/voice-commands";

export type DictationEdit =
  | { kind: "text"; text: string }
  | { kind: "paragraph" }
  | { kind: "line_break" }
  | { kind: "list_item" }
  | { kind: "opener"; mark: string };

export type RouteResult =
  | { kind: "edits"; edits: DictationEdit[]; spokenPunctuationCount?: number; capsLock?: boolean }
  | ({ kind: "voice_command" } & VoiceCommandRun)
  | { kind: "click"; name: string }
  | { kind: "click_number"; n: number }
  | { kind: "scratch" };

export interface RouteOptions {
  verbatim?: boolean;
}

export type Interpreter = (
  text: string,
  before: string,
  options?: RouteOptions
) => RouteResult | null;

export function createRouter(
  interpreter?: Interpreter
): (text: string, before: string, options?: RouteOptions) => RouteResult {
  return (text, before, options) =>
    interpreter?.(text, before, options) ?? { kind: "edits", edits: [{ kind: "text", text }] };
}
