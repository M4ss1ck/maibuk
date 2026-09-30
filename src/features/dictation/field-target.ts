// A Dictation target for plain text fields (`Input`, `textarea`): while a
// field holds the caret it registers as the Session's target, so a voice-only
// author can name a Book, type a search, or fill any dialog field.
import { appLanguage } from "@/features/settings/app-language";
import { dictationHub } from "@/features/dictation/hub";
import {
  dictationFieldKind,
  EMPTY_FIELD_HISTORY,
  FIELD_BEFORE_LIMIT,
  isVerbatimField,
  planFieldEdits,
  planFieldScratch,
  recordFieldInsert,
  type FieldHistory,
  type FieldKind,
} from "@/features/dictation/plain-text";
import type { DictationEdit } from "@/features/dictation/router";
import type { DictationTarget, ScratchOutcome } from "@/features/dictation/session";
import type {
  VoiceCommandRun,
  VoiceOutcome,
} from "@/features/dictation/voice-commands";
import { isOutsideLayer } from "@/lib/top-layer";

/**
 * One Dictation target for a focused text field. Dictated lines land through
 * the browser's own editing (one native undo step), so `common.undo` undoes
 * them; "scratch that" removes the last dictated sentence the same way.
 */
export function createFieldTarget(
  el: HTMLInputElement | HTMLTextAreaElement,
  kind: FieldKind
): DictationTarget {
  const id = crypto.randomUUID();
  const doc = el.ownerDocument;
  const multiline = kind === "multiline";
  const secret = kind === "secret";
  let history: FieldHistory = EMPTY_FIELD_HISTORY;

  // One native undo step through the browser's own editing.
  function replaceRange(
    from: number,
    to: number,
    text: string,
    expected: string,
    caret: number
  ): void {
    let native = false;
    if (el.selectionStart !== null && typeof doc.execCommand === "function") {
      el.setSelectionRange(from, to);
      const ok =
        text === ""
          ? doc.execCommand("delete")
          : doc.execCommand("insertText", false, text);
      native = ok && el.value === expected;
    }
    if (!native) {
      // The browser refused, jsdom has no editing commands, or the input type
      // exposes no selection API (email): set the value through the element
      // prototype's native setter — this is what lets React's controlled
      // inputs notice — then announce it as an input.
      Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(el),
        "value"
      )?.set?.call(el, expected);
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: text === "" ? "deleteContentBackward" : "insertText",
          data: text === "" ? null : text,
        })
      );
    }
    if (el.selectionStart !== null) el.setSelectionRange(caret, caret);
  }

  const target: DictationTarget = {
    id,
    language: () => appLanguage(),
    secret: kind === "secret",
    isAvailable: () =>
      el.isConnected &&
      doc.activeElement === el &&
      dictationFieldKind(el) === kind &&
      !isOutsideLayer(el),
    verbatim: () => isVerbatimField(el),
    showPartial: () => {
      // Partial text never touches a field: search filters and inline renames
      // must not churn under an in-progress line.
    },
    before: () => {
      const caret = el.selectionStart ?? el.value.length;
      return el.value.slice(Math.max(0, caret - FIELD_BEFORE_LIMIT), caret);
    },
    apply: (edits: DictationEdit[]) => {
      if (secret) return;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      const plan = planFieldEdits(el.value, start, end, edits, multiline);
      if (!plan.changed)
        return plan.layoutIgnored ? "layout_ignored" : "applied";
      const valueBefore = el.value;
      replaceRange(plan.from, plan.to, plan.text, plan.value, plan.caret);
      history = recordFieldInsert(history, valueBefore, plan);
      return plan.layoutIgnored ? "layout_ignored" : "applied";
    },
    // Secret targets get no voice member: undo/redo would read the password
    // back through the value comparison, and formatting has nothing to act on.
    ...(!secret
      ? {
          voice: (run: VoiceCommandRun): VoiceOutcome => {
            if (run.id !== "common.undo" && run.id !== "common.redo")
              return "unavailable";
            const valueBefore = el.value;
            if (run.id === "common.undo") doc.execCommand?.("undo");
            else doc.execCommand?.("redo");
            return el.value !== valueBefore ? "ran" : "empty";
          },
        }
      : {}),
    scratch: (): ScratchOutcome => {
      if (secret) return "empty";
      const p = planFieldScratch(history, el.value);
      if (p.outcome !== "removed") return p.outcome;
      replaceRange(p.from, p.to, "", p.value, p.from);
      history = p.history;
      return "removed";
    },
    resetScratch: () => {
      history = EMPTY_FIELD_HISTORY;
    },
  };
  return target;
}

/**
 * The only wiring plain fields need: no per-component hooks. While a text
 * field holds the caret it is the Session's target; at most one field target
 * is registered at a time.
 */
export function installDictationFieldTracker(
  doc: Document = document
): () => void {
  let current: {
    el: HTMLInputElement | HTMLTextAreaElement;
    targetId: string;
    unregister: () => void;
  } | null = null;

  function track(el: HTMLInputElement | HTMLTextAreaElement, kind: FieldKind): void {
    if (current?.el === el) {
      dictationHub.focus(current.targetId);
      return;
    }
    const target = createFieldTarget(el, kind);
    const unregister = dictationHub.register(target);
    dictationHub.focus(target.id);
    // Register the new field before unregistering the old one so the Session
    // never sees "no target" and stops mid-dictation.
    current?.unregister();
    current = { el, targetId: target.id, unregister };
  }

  function onFocusIn(event: FocusEvent): void {
    const candidate = event.target as Element | null;
    const kind = dictationFieldKind(candidate);
    if (kind === null) return;
    if (
      !(candidate instanceof HTMLInputElement) &&
      !(candidate instanceof HTMLTextAreaElement)
    )
      return;
    track(candidate, kind);
  }

  doc.addEventListener("focusin", onFocusIn, true);
  // A field focused before install (an autofocused dialog field) never fires
  // focusin again: pick it up now.
  const active = doc.activeElement;
  const initialKind = dictationFieldKind(active);
  if (
    initialKind !== null &&
    (active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement)
  ) {
    track(active, initialKind);
  }
  return () => {
    doc.removeEventListener("focusin", onFocusIn, true);
    // The field stays registered after it loses the caret (isAvailable turns
    // false) so the Session does not stop when focus moves to a dialog's
    // button; uninstall is the only path that drops it here.
    current?.unregister();
    current = null;
  };
}
