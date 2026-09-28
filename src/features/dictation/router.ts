// Every finished line passes through this seam before reaching an editor.
// The Interpreter will later produce layout edits, Voice Commands, and scratch requests.
export type DictationEdit = { kind: "text"; text: string };

export type RouteResult =
  | { kind: "edits"; edits: DictationEdit[] }
  | { kind: "voice_command"; id: string }
  | { kind: "scratch" };

export type Interpreter = (text: string, before: string) => RouteResult | null;

export function createRouter(
  interpreter?: Interpreter
): (text: string, before: string) => RouteResult {
  return (text, before) =>
    interpreter?.(text, before) ?? { kind: "edits", edits: [{ kind: "text", text }] };
}
