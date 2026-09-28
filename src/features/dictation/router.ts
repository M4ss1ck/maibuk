// Every finished line passes through here on its way to the editor. v1 inserts
// it; the Dictation Command Interpreter (Anticipated) plugs in as `interpreter`
// to turn phrases into punctuation, corrections, or Voice Commands.
export type RouteResult = { kind: "insert"; text: string } | { kind: "command"; id: string };
export type Interpreter = (text: string) => RouteResult | null;

export function createRouter(interpreter?: Interpreter): (text: string) => RouteResult {
  return (text) => interpreter?.(text) ?? { kind: "insert", text };
}
