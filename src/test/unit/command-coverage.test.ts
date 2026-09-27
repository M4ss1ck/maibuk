import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { isCommandId } from "@/lib/shortcut-registry";

// Every action an author can run should be a Command they can bind to a
// Shortcut. This scan fails when a new menu entry, Item Menu action, toolbar
// button or color picker ships without a `commandId` / `data-command` /
// `shortcut`, or without a stated `data-command-exempt` / `// command-exempt:`
// reason. Attributes are not commands; naming the Command is what makes the
// action bindable, findable in the Shortcut help, and testable.

const SRC = join(process.cwd(), "src");

// ItemActionsMenu renders the Item Menu itself: its own MenuItem is the shared
// implementation, not an app menu entry, so it is not scanned.
const SKIP_ITEM_MENU = "components/ui/ItemActionsMenu.tsx";

// CanvasToolPanel defines its own ToolbarButton (a plain canvas tool button,
// not the editor toolbar primitive), so its `<ToolbarButton` tags are not the
// ones this guard is about.
const SKIP_TOOLBAR_BUTTON = "features/canvas/CanvasToolPanel.tsx";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "test" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

/** Blanks string literals and comments so only code braces remain. */
function maskNonCode(source: string): string {
  const out = source.split("");
  let state: "code" | "line" | "block" | "single" | "double" | "template" = "code";
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === "code") {
      if (ch === "/" && next === "/") {
        state = "line";
        out[i] = " ";
      } else if (ch === "/" && next === "*") {
        state = "block";
        out[i] = " ";
      } else if (ch === "'") {
        state = "single";
        out[i] = " ";
      } else if (ch === '"') {
        state = "double";
        out[i] = " ";
      } else if (ch === "`") {
        state = "template";
        out[i] = " ";
      }
      continue;
    }
    if (state === "line") {
      if (ch === "\n") state = "code";
      else out[i] = " ";
      continue;
    }
    if (state === "block") {
      if (ch === "*" && next === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        i++;
        state = "code";
      } else if (ch !== "\n") {
        out[i] = " ";
      }
      continue;
    }
    // string states
    if (ch === "\\") {
      out[i] = " ";
      if (next !== undefined && next !== "\n") out[i + 1] = " ";
      i++;
      continue;
    }
    if (
      (state === "single" && ch === "'") ||
      (state === "double" && ch === '"') ||
      (state === "template" && ch === "`")
    ) {
      state = "code";
    }
    if (ch !== "\n") out[i] = " ";
  }
  return out.join("");
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function previousLine(source: string, index: number): string {
  const before = source.slice(0, index);
  const lines = before.split("\n");
  return lines.length >= 2 ? lines[lines.length - 2] : "";
}

function enclosingBrace(masked: string, index: number): number {
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    if (masked[i] === "}") depth++;
    else if (masked[i] === "{") {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

function matchingBrace(masked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === "{") depth++;
    else if (masked[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The opening tag text at `start`, up to and including its closing `>`. */
function tagText(source: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

function tagStarts(source: string, name: string): number[] {
  const starts: number[] = [];
  const re = new RegExp(`<${name}(?=[\\s/>])`, "g");
  for (let match = re.exec(source); match !== null; match = re.exec(source))
    starts.push(match.index);
  return starts;
}

interface Offender {
  file: string;
  line: number;
  detail: string;
}

function scanItemActions(): Offender[] {
  const offenders: Offender[] = [];
  for (const file of sourceFiles(SRC)) {
    const name = relative(SRC, file);
    const raw = readFileSync(file, "utf8");
    const masked = maskNonCode(raw);
    for (const match of masked.matchAll(/\blabel\s*:/g)) {
      const labelIndex = match.index ?? 0;
      const open = enclosingBrace(masked, labelIndex);
      if (open === -1) continue;
      const close = matchingBrace(masked, open);
      if (close === -1) continue;
      const body = masked.slice(open, close + 1);
      if (!/\bonAction\s*:/.test(body)) continue;
      if (/\bcommandId\s*:/.test(body)) continue;
      if (/\bchildren\s*:/.test(body)) continue;
      if (previousLine(raw, open).includes("// command-exempt:")) continue;
      offenders.push({
        file: name,
        line: lineAt(raw, open),
        detail: "object literal with label and onAction has no commandId, children, or exemption",
      });
    }
  }
  return offenders;
}

function scanAttributes(
  name: "MenuItem" | "ToolbarButton" | "ColorPicker",
  skipFiles: string[],
  accepted: RegExp
): Offender[] {
  const offenders: Offender[] = [];
  for (const file of sourceFiles(SRC)) {
    const relativeName = relative(SRC, file);
    if (skipFiles.includes(relativeName)) continue;
    const source = readFileSync(file, "utf8");
    for (const start of tagStarts(source, name)) {
      const text = tagText(source, start);
      if (accepted.test(text)) continue;
      offenders.push({
        file: relativeName,
        line: lineAt(source, start),
        detail: `<${name}> has no command/exemption attribute`,
      });
    }
  }
  return offenders;
}

function scanCommandIds(): Offender[] {
  const offenders: Offender[] = [];
  for (const file of sourceFiles(SRC)) {
    const relativeName = relative(SRC, file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/data-command="([^"]+)"/g)) {
      if (!isCommandId(match[1])) {
        offenders.push({
          file: relativeName,
          line: lineAt(source, match.index ?? 0),
          detail: `data-command="${match[1]}" is not a registry Command id`,
        });
      }
    }
  }
  return offenders;
}

describe("command coverage", () => {
  it("gives every menu-style action object a commandId, children, or an exemption", () => {
    expect(scanItemActions()).toEqual([]);
  });

  it("marks every MenuItem with data-command or data-command-exempt", () => {
    expect(scanAttributes("MenuItem", [SKIP_ITEM_MENU], /data-command(?:-exempt)?=/)).toEqual([]);
  });

  it("marks every ToolbarButton and ColorPicker with shortcut or data-command-exempt", () => {
    const skip = [SKIP_ITEM_MENU, SKIP_TOOLBAR_BUTTON];
    const accepted = /(?:shortcut=|data-command-exempt=)/;
    expect([
      ...scanAttributes("ToolbarButton", skip, accepted),
      ...scanAttributes("ColorPicker", skip, accepted),
    ]).toEqual([]);
  });

  it("points every data-command at a registry Command id", () => {
    expect(scanCommandIds()).toEqual([]);
  });
});
