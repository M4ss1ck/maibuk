import type { Shortcut, Step } from "@/lib/shortcut-registry";

export interface ParsedStep {
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

export interface FormattedShortcut {
  groups: string[][];
  isSequence: boolean;
}

/** `event.key` values that name a modifier rather than a key the author can bind. */
const MODIFIER_NAMES = new Set(["shift", "control", "meta", "alt", "altgraph", "os"]);
const DEAD_KEYS = new Set(["dead", "process", "unidentified"]);

const NAMED_KEYS: Record<string, string> = {
  esc: "Escape",
  escape: "Escape",
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  space: "Space",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  arrowup: "ArrowUp",
  up: "ArrowUp",
  arrowdown: "ArrowDown",
  down: "ArrowDown",
  arrowleft: "ArrowLeft",
  left: "ArrowLeft",
  arrowright: "ArrowRight",
  right: "ArrowRight",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  insert: "Insert",
};

for (let n = 1; n <= 24; n += 1) {
  NAMED_KEYS[`f${n}`] = `F${n}`;
}

const LETTER = /^\p{L}$/u;
const DIGIT = /^[0-9]$/;

/** A trailing "+" is the key, not a separator, so "Mod++" is Mod and key "+". */
function tokenize(step: string): string[] {
  if (step.endsWith("+")) {
    const parts = step.slice(0, -1).split("+");
    if (parts[parts.length - 1] === "") parts.pop();
    return [...parts, "+"];
  }
  return step.split("+");
}

function canonicalKey(raw: string): string | null {
  if (raw === " ") return "Space";
  if (raw.length === 0) return null;
  if (raw.length === 1) return LETTER.test(raw) ? raw.toLowerCase() : raw;
  const lower = raw.toLowerCase();
  if (MODIFIER_NAMES.has(lower) || DEAD_KEYS.has(lower)) return null;
  return NAMED_KEYS[lower] ?? null;
}

export function parseStep(step: Step): ParsedStep | null {
  if (step === "") return null;
  const tokens = tokenize(step);
  const keyToken = tokens[tokens.length - 1];
  const modifierTokens = tokens.slice(0, -1);

  const parsed: ParsedStep = {
    mod: false,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    key: "",
  };

  for (const token of modifierTokens) {
    switch (token.toLowerCase()) {
      case "mod":
        if (parsed.mod) return null;
        parsed.mod = true;
        break;
      case "ctrl":
      case "control":
        if (parsed.ctrl) return null;
        parsed.ctrl = true;
        break;
      case "meta":
      case "cmd":
      case "command":
        if (parsed.meta) return null;
        parsed.meta = true;
        break;
      case "alt":
      case "option":
        if (parsed.alt) return null;
        parsed.alt = true;
        break;
      case "shift":
        if (parsed.shift) return null;
        parsed.shift = true;
        break;
      default:
        return null;
    }
  }

  const key = canonicalKey(keyToken);
  if (key === null) return null;
  parsed.key = key;
  return parsed;
}

export function normalizeStep(step: Step): Step | null {
  const parsed = parseStep(step);
  if (parsed === null) return null;

  const parts: string[] = [];
  if (parsed.mod) parts.push("Mod");
  if (parsed.ctrl) parts.push("Ctrl");
  if (parsed.meta) parts.push("Meta");
  if (parsed.alt) parts.push("Alt");
  if (parsed.shift) parts.push("Shift");
  parts.push(parsed.key);
  return parts.join("+");
}

export function normalizeShortcut(shortcut: readonly string[]): Shortcut | null {
  if (shortcut.length < 1 || shortcut.length > 2) return null;
  const steps: Step[] = [];
  for (const step of shortcut) {
    const normalized = normalizeStep(step);
    if (normalized === null) return null;
    steps.push(normalized);
  }
  return steps;
}

export function shortcutKey(shortcut: Shortcut): string {
  return shortcut.join(" ");
}

/** US positions of the physical keys, for layouts whose `key` is not Latin. */
const CODE_KEYS: Record<string, string> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
};

function codeKey(code: string): string | null {
  const letterOrDigit = /^Key([A-Z])$/.exec(code) ?? /^Digit([0-9])$/.exec(code);
  if (letterOrDigit) return letterOrDigit[1].toLowerCase();
  return CODE_KEYS[code] ?? null;
}

type KeyEventLike = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
>;

function eventModifiers(event: KeyEventLike, mac: boolean, shift: boolean): string[] {
  const modifiers: string[] = [];
  if (mac) {
    if (event.metaKey) modifiers.push("Mod");
    if (event.ctrlKey) modifiers.push("Ctrl");
  } else {
    if (event.ctrlKey) modifiers.push("Mod");
    if (event.metaKey) modifiers.push("Meta");
  }
  if (event.altKey) modifiers.push("Alt");
  if (shift && event.shiftKey) modifiers.push("Shift");
  return modifiers;
}

function isSymbol(key: string): boolean {
  return key.length === 1 && !LETTER.test(key) && !DIGIT.test(key);
}

/**
 * The Steps one key press can mean, most specific first: the exact combo; the
 * typed symbol without Shift, since Shift is how a layout reaches "?" or "<";
 * and the US key at the same physical position, for layouts whose `key` is not
 * a Latin letter or digit (Cyrillic Ctrl+S) or that shift a symbol (Ctrl+Shift+,
 * types "<" on a US keyboard).
 */
export function stepsFromEvent(event: KeyEventLike, mac: boolean): Step[] {
  const canonical = canonicalKey(event.key);
  if (canonical === null) return [];

  const candidates: (Step | null)[] = [
    normalizeStep([...eventModifiers(event, mac, true), event.key].join("+")),
  ];
  if (event.shiftKey && isSymbol(canonical)) {
    candidates.push(normalizeStep([...eventModifiers(event, mac, false), event.key].join("+")));
  }
  if (!(canonical.length === 1 && /^[a-z0-9]$/.test(canonical))) {
    const physical = codeKey(event.code);
    if (physical !== null) {
      candidates.push(normalizeStep([...eventModifiers(event, mac, true), physical].join("+")));
    }
  }

  return [...new Set(candidates.filter((step): step is Step => step !== null))];
}

/** What the recorder stores for a key press: the combo as the author typed it. */
export function recordedStepFromEvent(event: KeyEventLike, mac: boolean): Step | null {
  const canonical = canonicalKey(event.key);
  if (canonical === null) return null;
  return normalizeStep([...eventModifiers(event, mac, !isSymbol(canonical)), event.key].join("+"));
}

export function isIgnoredKeyEvent(
  event: Pick<KeyboardEvent, "key" | "isComposing" | "keyCode">
): boolean {
  if (event.isComposing) return true;
  if (event.keyCode === 229) return true;
  return DEAD_KEYS.has(event.key.toLowerCase());
}

export function isRecordableStep(step: Step): boolean {
  const normalized = normalizeStep(step);
  if (normalized === null) return false;
  return (
    normalized !== "Enter" &&
    normalized !== "Escape" &&
    normalized !== "Tab" &&
    normalized !== "Shift+Tab"
  );
}

const RESERVED_ON_WEB = new Set([
  "Mod+n",
  "Mod+t",
  "Mod+w",
  "Mod+Shift+n",
  "Mod+Shift+p",
  "Mod+Shift+t",
  "Mod+Shift+w",
  "Mod+Tab",
  "Mod+Shift+Tab",
  "Ctrl+Tab",
  "Ctrl+Shift+Tab",
]);

export function isReservedOnWeb(step: Step): boolean {
  const normalized = normalizeStep(step);
  return normalized !== null && RESERVED_ON_WEB.has(normalized);
}

export function isSingleKey(shortcut: Shortcut): boolean {
  return shortcut.every((step) => {
    const parsed = parseStep(step);
    if (parsed === null) return false;
    return !parsed.mod && !parsed.ctrl && !parsed.meta && !parsed.alt;
  });
}

function formatKey(key: string): string {
  if (key === "Escape") return "Esc";
  switch (key) {
    case "ArrowUp":
      return "↑";
    case "ArrowDown":
      return "↓";
    case "ArrowLeft":
      return "←";
    case "ArrowRight":
      return "→";
    default:
      break;
  }
  return LETTER.test(key) ? key.toUpperCase() : key;
}

export function formatShortcut(shortcut: Shortcut, mac: boolean): FormattedShortcut {
  const groups = shortcut.map((step) => {
    const parsed = parseStep(step);
    if (parsed === null) return [];
    const chips: string[] = [];
    if (parsed.mod) chips.push(mac ? "⌘" : "Ctrl");
    if (parsed.ctrl) chips.push(mac ? "⌃" : "Ctrl");
    if (parsed.meta) chips.push(mac ? "⌘" : "Meta");
    if (parsed.alt) chips.push(mac ? "⌥" : "Alt");
    if (parsed.shift) chips.push(mac ? "⇧" : "Shift");
    chips.push(formatKey(parsed.key));
    return chips;
  });
  return { groups, isSequence: shortcut.length > 1 };
}

export function toAriaKeyShortcuts(shortcut: Shortcut, mac: boolean): string | null {
  if (shortcut.length !== 1) return null;
  const parsed = parseStep(shortcut[0]);
  if (parsed === null || parsed.key === "+") return null;

  const parts: string[] = [];
  if (parsed.mod) parts.push(mac ? "Meta" : "Control");
  if (parsed.ctrl) parts.push("Control");
  if (parsed.meta) parts.push("Meta");
  if (parsed.alt) parts.push("Alt");
  if (parsed.shift) parts.push("Shift");
  parts.push(LETTER.test(parsed.key) ? parsed.key.toUpperCase() : parsed.key);
  return parts.join("+");
}

/**
 * Whether a Shortcut can run while the author types: its first step needs Mod,
 * Ctrl, Meta or Alt, or is a function key. Anything else would type text.
 */
export function isTypingSafe(shortcut: Shortcut): boolean {
  const parsed = shortcut.length > 0 ? parseStep(shortcut[0]) : null;
  if (parsed === null) return false;
  return parsed.mod || parsed.ctrl || parsed.meta || parsed.alt || /^F\d+$/.test(parsed.key);
}
