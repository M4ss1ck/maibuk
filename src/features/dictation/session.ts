// The one Dictation Session per app (framework-free, like the Edit Session).
// It knows targets (editors and text fields), a language, and a RecognizerHost; it never
// knows which engine or platform is underneath.
import type { LineStats } from "@/features/dictation/stats";
import type { DictationEdit, RouteOptions, RouteResult } from "@/features/dictation/router";
import { findSentenceStartOffset } from "@/features/dictation/interpreter";
import type { VoiceCommandRun, VoiceOutcome } from "@/features/dictation/voice-commands";
import {
  toDictationError,
  type DictationErrorCode,
  type DictationEvent,
  type DictationLanguage,
  type ModelSpec,
  type RecognizerHost,
} from "@/features/dictation/types";
import type { CommandId } from "@/lib/shortcut-registry";
import type { CommandRunOutcome } from "@/lib/command-runner";

/** What a scratch request did on its target. `refused` means the author edited inside the dictated text. */
export type ScratchOutcome = "removed" | "refused" | "empty";

/** What applying one finished line did. `layout_ignored` dropped a line break, paragraph, or list item the field cannot hold; the rest was inserted. */
export type ApplyOutcome = "applied" | "layout_ignored";

export interface DictationTarget {
  id: string;
  language(): DictationLanguage;
  /** Shows the in-progress line; "" clears it. Never changes the document. */
  showPartial(text: string): void;
  /** At most 256 characters before the caret; never the whole document. */
  before(): string;
  /** Applies one finished line as one undo step. */
  // biome-ignore lint/suspicious/noConfusingVoidType: editor targets and fakes that report nothing stay assignable.
  apply(edits: DictationEdit[]): ApplyOutcome | void;
  /** False while hidden behind the topmost modal layer or no longer holding the caret; the Session treats it as absent. */
  isAvailable?(): boolean;
  /** The target takes each line as heard (phrase editors): no Spoken Punctuation, no Vocabulary. */
  verbatim?(): boolean;
  /** A password field: dictated text is refused and never read, shown, or copied. */
  secret?: boolean;
  /**
   * Runs one Voice Command on this target's editor. The polarity picks a
   * mark's set or unset runner; "empty" is an action with nothing to do.
   * Absent targets run none.
   */
  voice?(run: VoiceCommandRun): VoiceOutcome;
  /** Removes the last dictated sentence as one undo step. Absent targets ignore scratch. */
  scratch?(): ScratchOutcome;
  /** Drops the dictated history so scratch never reaches into another editor. Absent targets keep no history. */
  resetScratch?(): void;
}

export type SessionStatus = "idle" | "loading" | "listening" | "stopping";

export type SessionNotice =
  | { kind: "started"; language: DictationLanguage }
  | { kind: "stopped" }
  | { kind: "error"; code: DictationErrorCode; language?: DictationLanguage }
  | { kind: "orphan_copied" }
  // The clipboard refused (unfocused window, no permission): the UI shows the phrase instead.
  | { kind: "orphan_lost"; text: string }
  // Scratch that found edited dictated text: nothing removed, the live region says so.
  | { kind: "scratch_refused" }
  // Scratch that had nothing to remove: the live region says so.
  | { kind: "scratch_empty" }
  // A Voice Command ran: the live region says which one, so a spoken action
  // with no visible cause is never silent.
  | ({ kind: "voice_command" } & VoiceCommandRun)
  // A Voice Command had nothing to do ("undo that" on an empty history): the
  // live region says so, and the stats do not count it as a run.
  | { kind: "voice_command_empty"; id: CommandId }
  // A Voice Command whose Command has no live binding here: the live region
  // says so, and the stats count it as unavailable.
  | { kind: "voice_command_unavailable"; id: CommandId }
  // A Voice Command that changed the screen but no editor took the caret in
  // time: the queued lines went to the clipboard path, and the Session stopped.
  | { kind: "handoff_no_editor" }
  // A Voice Command refused by a gate (an open dialog, the Tutorial): the
  // live region says so, and the stats count it as refused.
  | { kind: "voice_command_refused"; id: CommandId; reason: "dialog" | "tutorial" | "dialog_refused" }
  // The all-caps lock changed: the live region says whether it is on or off.
  | { kind: "caps_lock"; on: boolean }
  // "Bold that" on edited dictated text: nothing changed, the live region says so.
  | { kind: "voice_that_refused" }
  // "Bold that" with nothing dictated yet: the live region says so.
  | { kind: "voice_that_empty" }
  // Click by Name pressed one control: the live region names it.
  | { kind: "click_pressed"; name: string }
  // Click by Name found several controls: the live region says how many.
  | { kind: "click_choices"; count: number }
  // Click by Name found nothing called that: the live region names it.
  | { kind: "click_not_found"; name: string }
  // A password field refused dictated text.
  | { kind: "field_secret_refused" }
  // A single-line field dropped a line break, paragraph, or list item.
  | { kind: "field_layout_ignored" };

export interface SessionSnapshot {
  status: SessionStatus;
  language: DictationLanguage | null;
  modelId: string | null;
  level: number;
  hasTarget: boolean;
}

export interface DictationSession {
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
  register(target: DictationTarget): () => void;
  focus(targetId: string): void;
  toggle(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  setLanguage(language: DictationLanguage | null): Promise<void>;
  languageOverride(): DictationLanguage | null;
}

/**
 * How long a navigating Voice Command waits for an editor to take the caret
 * on the new screen: long enough for a route change plus an editor mount on a
 * slow phone, short enough that a forgotten mic does not stay on.
 */
export const HANDOFF_LIMIT_MS = 4000;

/**
 * Plain-text rendering for the orphan path (no editor target). Layout edits
 * become line breaks; an opener is inserted at the start of its sentence in
 * the text built so far, using the interpreter's boundary rule.
 */
export function editsToOrphanText(edits: DictationEdit[]): string {
  let out = "";
  for (const edit of edits) {
    if (edit.kind === "text") out += edit.text;
    else if (edit.kind === "opener") {
      const at = findSentenceStartOffset(out);
      out = out.slice(0, at) + edit.mark + out.slice(at);
    } else out += "\n";
  }
  return out;
}

export interface ClickDeps {
  pressByName(name: string):
    | { kind: "pressed"; name: string }
    | { kind: "choices"; count: number }
    | { kind: "not_found" };
  pressChoice(n: number): { kind: "pressed"; name: string } | { kind: "no_choice" };
  clearChoices(): void;
  hasChoices(): boolean;
}

export function createDictationSession(deps: {
  host: RecognizerHost;
  modelFor: (language: DictationLanguage) => ModelSpec | null;
  route: (text: string, before: string, options?: RouteOptions) => RouteResult;
  /** False while the Tutorial runs: no Voice Command may act (ADR 0008), like Shortcuts. */
  voiceCommandsAllowed?: () => boolean;
  /**
   * Runs a non-editor Command without a key event (the Command Runner). When
   * present, Commands that are not editor-keymap Commands run through it.
   */
  runCommand?: (id: CommandId) => Promise<CommandRunOutcome>;
  /** Whether the Command runs inside the editor's own keymap. */
  isEditorCommand?: (id: CommandId) => boolean;
  /** Whether the Command changes the screen (COMMANDS[id].navigates). */
  isNavigatingCommand?: (id: CommandId) => boolean;
  notify: (notice: SessionNotice) => void;
  copyText: (text: string) => Promise<void>;
  stats: LineStats;
  isEnabled?: () => boolean;
  /** Click by Name's DOM press; absent in tests that never route a click line. */
  click?: ClickDeps;
}): DictationSession {
  const targets = new Map<string, DictationTarget>();
  /** Most recently focused last; the active target is the last one still registered. */
  const focusOrder: string[] = [];
  const listeners = new Set<() => void>();
  let snapshot: SessionSnapshot = {
    status: "idle",
    language: null,
    modelId: null,
    level: 0,
    hasTarget: false,
  };
  let override: DictationLanguage | null = null;
  let partial = "";
  let stopRequested = false;
  let starting: Promise<void> | null = null;
  let stopping: Promise<void> | null = null;

  const set = (patch: Partial<SessionSnapshot>) => {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof SessionSnapshot)[]) {
      if (!Object.is(snapshot[key], patch[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };

  const active = (): DictationTarget | null => {
    for (let i = focusOrder.length - 1; i >= 0; i--) {
      const target = targets.get(focusOrder[i]);
      if (!target) continue;
      if (target.isAvailable?.() === false) continue;
      return target;
    }
    return null;
  };

  const showPartial = (text: string) => {
    partial = text;
    const target = active();
    if (target?.secret) return;
    target?.showPartial(text);
  };

  // A navigating Voice Command keeps the Session listening across the route
  // change. While the window is open the old editor may unregister without
  // stopping the Session, and finished lines queue as raw text until an editor
  // takes the caret (focus) or the wait runs out (the timer).
  interface HandoffWindow {
    queue: string[];
    timer: ReturnType<typeof setTimeout> | null;
  }
  let handoff: HandoffWindow | null = null;

  const closeHandoff = () => {
    if (handoff?.timer) clearTimeout(handoff.timer);
    handoff = null;
  };

  // One code path for every finished line, live or queued: Voice Commands,
  // scratch, Click by Name, and edits behave the same wherever the line waited.
  const applyFinishedLine = (text: string, target: DictationTarget | null) => {
    const startedAt = performance.now();
    const before = target?.secret ? "" : (target?.before() ?? "");
    const result = deps.route(text, before, {
      verbatim: target?.verbatim?.() === true,
    });
    const interpreterMs = performance.now() - startedAt;
    // Click by Name owns numbered choices until a number answers them: any
    // other line drops them first, then runs normally. Click lines never
    // insert text and never pass the Tutorial gate.
    if (result.kind === "click_number") {
      if (deps.click?.hasChoices()) {
        const outcome = deps.click.pressChoice(result.n);
        if (outcome.kind === "pressed") {
          deps.stats.recordInterpreter(interpreterMs, 0, 0, 1);
          deps.notify({ kind: "click_pressed", name: outcome.name });
        } else {
          deps.stats.recordInterpreter(interpreterMs, 0, 0, 0, 1, 0);
          deps.notify({ kind: "click_not_found", name: String(result.n) });
        }
        return;
      }
      const outcome = deps.click?.pressByName(String(result.n)) ?? { kind: "not_found" as const };
      if (outcome.kind === "pressed") {
        deps.stats.recordInterpreter(interpreterMs, 0, 0, 1);
        deps.notify({ kind: "click_pressed", name: outcome.name });
      } else if (outcome.kind === "choices") {
        deps.stats.recordInterpreter(interpreterMs, 0, 0, 1);
        deps.notify({ kind: "click_choices", count: outcome.count });
      } else {
        deps.stats.recordInterpreter(interpreterMs, 0, 0, 0, 1, 0);
        deps.notify({ kind: "click_not_found", name: String(result.n) });
      }
      return;
    }
    if (result.kind === "click") {
      // A fresh "click <name>" drops stale choices before pressing.
      deps.click?.clearChoices();
      const outcome = deps.click?.pressByName(result.name) ?? { kind: "not_found" as const };
      if (outcome.kind === "pressed") {
        deps.stats.recordInterpreter(interpreterMs, 0, 0, 1);
        deps.notify({ kind: "click_pressed", name: outcome.name });
      } else if (outcome.kind === "choices") {
        deps.stats.recordInterpreter(interpreterMs, 0, 0, 1);
        deps.notify({ kind: "click_choices", count: outcome.count });
      } else {
        deps.stats.recordInterpreter(interpreterMs, 0, 0, 0, 1, 0);
        deps.notify({ kind: "click_not_found", name: result.name });
      }
      return;
    }
    if (deps.click?.hasChoices()) deps.click.clearChoices();
    // The Tutorial gate is the Shortcuts one: while a run is under way no
    // Voice Command acts, and its words are never inserted either. Only a
    // Command that really ran counts; an empty action is announced instead.
    if (result.kind === "voice_command") {
      const run: VoiceCommandRun = {
        id: result.id,
        polarity: result.polarity,
        ...(result.that ? { that: true as const } : {}),
      };
      // A Command outside the editor's keymap runs through the Command
      // Runner, never as text; editor Commands run on the target's editor.
      if (deps.isEditorCommand?.(result.id) === false && deps.runCommand) {
        const runCommand = deps.runCommand;
        const navigating = deps.isNavigatingCommand?.(result.id) === true;
        const pending: HandoffWindow | null = navigating ? { queue: [], timer: null } : null;
        if (pending) handoff = pending;
        void Promise.resolve(runCommand(result.id)).then((outcome) => {
          if (outcome === "ran") {
            deps.stats.recordInterpreter(interpreterMs, 0, 0, 1);
            deps.notify({ kind: "voice_command", ...run });
          } else if (outcome === "unavailable") {
            deps.stats.recordInterpreter(interpreterMs, 0, 0, 0, 1, 0);
            deps.notify({ kind: "voice_command_unavailable", id: run.id });
          } else if (outcome === "refused-dialog") {
            deps.stats.recordInterpreter(interpreterMs, 0, 0, 0, 0, 1);
            deps.notify({ kind: "voice_command_refused", id: run.id, reason: "dialog" });
          } else if (outcome === "refused-dialog-close") {
            deps.stats.recordInterpreter(interpreterMs, 0, 0, 0, 0, 1);
            deps.notify({
              kind: "voice_command_refused",
              id: run.id,
              reason: "dialog_refused",
            });
          } else {
            deps.stats.recordInterpreter(interpreterMs, 0, 0, 0, 0, 1);
            deps.notify({ kind: "voice_command_refused", id: run.id, reason: "tutorial" });
          }
          if (!pending || handoff !== pending) return;
          if (outcome !== "ran") {
            // The screen did not change: the queued lines belong to the
            // editor that is still here, or to the clipboard path when none is.
            // A target hidden behind the dialog that refused is still here, so
            // the Session keeps listening and the refusal stays what is heard.
            const queued = pending.queue;
            handoff = null;
            const current = active();
            for (const line of queued) applyFinishedLine(line, current);
            if (targets.size === 0) void stop();
            return;
          }
          pending.timer = setTimeout(onHandoffTimeout, HANDOFF_LIMIT_MS);
        });
        return;
      }
      if (deps.voiceCommandsAllowed?.() === false) {
        deps.stats.recordInterpreter(interpreterMs, 0, 0, 0, 0, 1);
        deps.notify({ kind: "voice_command_refused", id: run.id, reason: "tutorial" });
        return;
      }
      const voice = target?.voice;
      if (!voice) {
        deps.stats.recordInterpreter(interpreterMs, 0, 0, 0, 1, 0);
        deps.notify({ kind: "voice_command_unavailable", id: run.id });
        return;
      }
      const voiceOutcome: VoiceOutcome = voice(run);
      if (voiceOutcome === "unavailable") {
        deps.stats.recordInterpreter(interpreterMs, 0, 0, 0, 1, 0);
        deps.notify({ kind: "voice_command_unavailable", id: run.id });
        return;
      }
      deps.stats.recordInterpreter(interpreterMs, 0, 0, voiceOutcome === "ran" ? 1 : 0);
      if (voiceOutcome === "ran") {
        deps.notify({ kind: "voice_command", ...run });
      } else if (voiceOutcome === "empty") {
        deps.notify(
          run.that ? { kind: "voice_that_empty" } : { kind: "voice_command_empty", id: run.id }
        );
      } else if (voiceOutcome === "refused" && run.that) {
        deps.notify({ kind: "voice_that_refused" });
      }
      return;
    }
    deps.stats.recordInterpreter(
      interpreterMs,
      result.kind === "edits" ? (result.spokenPunctuationCount ?? 0) : 0,
      result.kind === "scratch" ? 1 : 0,
      0
    );
    if (result.kind === "scratch") {
      const outcome = target?.scratch?.() ?? "empty";
      if (outcome === "refused") deps.notify({ kind: "scratch_refused" });
      else if (outcome === "empty") deps.notify({ kind: "scratch_empty" });
      return;
    }
    if (target?.secret && result.edits.length > 0) {
      deps.notify({ kind: "field_secret_refused" });
    } else if (target) {
      const outcome = target.apply(result.edits);
      if (outcome === "layout_ignored") deps.notify({ kind: "field_layout_ignored" });
    } else if (result.edits.length > 0) {
      const orphanText = editsToOrphanText(result.edits);
      deps.copyText(orphanText).then(
        () => deps.notify({ kind: "orphan_copied" }),
        () => deps.notify({ kind: "orphan_lost", text: orphanText })
      );
    }
    if (result.capsLock !== undefined) {
      deps.notify({ kind: "caps_lock", on: result.capsLock });
    }
  };

  const onHandoffTimeout = () => {
    const pending = handoff;
    if (!pending) return;
    handoff = null;
    const queued = pending.queue;
    const current = active();
    if (current) {
      // The old editor survived the run (the route kept it): the lines are its.
      for (const line of queued) applyFinishedLine(line, current);
      return;
    }
    // No editor took the caret: the lines go through the orphan path with no
    // surrounding text, then the Session stops, and the author is told why.
    // The handoff notice lands after the stop's own notice so the reason is
    // what the live region keeps.
    for (const line of queued) applyFinishedLine(line, null);
    void Promise.resolve(stop()).then(() => deps.notify({ kind: "handoff_no_editor" }));
  };

  const onEvent = (event: DictationEvent) => {
    switch (event.type) {
      case "level":
        set({ level: event.rms });
        return;
      case "partial":
        // While the hand-off window is open no editor owns the line in
        // progress, so partials are shown nowhere.
        if (handoff) return;
        showPartial(event.text);
        return;
      case "final": {
        deps.stats.record(event.latencyMs);
        if (handoff) {
          handoff.queue.push(event.text);
          return;
        }
        showPartial("");
        applyFinishedLine(event.text, active());
        return;
      }
      case "error":
        deps.notify({ kind: "error", code: event.code });
        void stop();
        return;
    }
  };

  async function start(): Promise<void> {
    if (deps.isEnabled?.() === false) return;
    if (starting) return starting;
    if (snapshot.status !== "idle") return;
    const target = active();
    if (!target) {
      deps.notify({ kind: "error", code: "no_target" });
      return;
    }
    const language = override ?? target.language();
    const spec = deps.modelFor(language);
    if (!spec) {
      deps.notify({ kind: "error", code: "model_missing", language });
      return;
    }
    stopRequested = false;
    set({ status: "loading", language, modelId: spec.id });
    starting = (async () => {
      try {
        await deps.host.load(spec);
        if (stopRequested || deps.isEnabled?.() === false) {
          set({ status: "idle", level: 0 });
          return;
        }
        await deps.host.start(onEvent);
        // Microphone permission/start can settle after the author turns Dictation off.
        if (stopRequested || deps.isEnabled?.() === false) {
          await deps.host.stop();
          showPartial("");
          set({ status: "idle", level: 0 });
          return;
        }
        set({ status: "listening" });
        deps.notify({ kind: "started", language });
      } catch (error) {
        set({ status: "idle", level: 0 });
        deps.notify({
          kind: "error",
          code: toDictationError(error, "engine_crashed").code,
        });
      }
    })();
    try {
      await starting;
    } finally {
      starting = null;
    }
  }

  async function stop(): Promise<void> {
    // Stopping (Escape, the toggle, an error) drops the hand-off wait: the
    // timer and whatever queued behind the route change go with it.
    if (handoff) closeHandoff();
    if (snapshot.status === "loading") {
      stopRequested = true;
      await starting;
      return;
    }
    if (stopping) return stopping;
    if (snapshot.status !== "listening") return;
    set({ status: "stopping" });
    stopping = (async () => {
      try {
        await deps.host.stop();
      } catch (error) {
        deps.notify({
          kind: "error",
          code: toDictationError(error, "engine_crashed").code,
        });
      } finally {
        showPartial("");
        set({ status: "idle", level: 0 });
        deps.notify({ kind: "stopped" });
      }
    })();
    try {
      await stopping;
    } finally {
      stopping = null;
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    register(target) {
      targets.set(target.id, target);
      set({ hasTarget: true });
      return () => {
        const wasActive = active()?.id === target.id;
        targets.delete(target.id);
        const index = focusOrder.indexOf(target.id);
        if (index >= 0) focusOrder.splice(index, 1);
        set({ hasTarget: targets.size > 0 });
        if (!wasActive) return;
        const next = active();
        if (next && !next.secret) next.showPartial(partial);
        // While the hand-off window is open the route change is expected: the
        // old editor leaving does not stop the Session, which waits for the
        // next editor to take the caret instead.
        else if (handoff) return;
        else if (snapshot.status === "listening" || snapshot.status === "loading") void stop();
      };
    },
    focus(targetId) {
      const target = targets.get(targetId);
      if (!target) return;
      const pending = handoff;
      // The previous target is the most recently focused one still registered,
      // even when it already lost the caret (isAvailable false): an unfocused
      // field still drops its dictated history when another target takes focus.
      let previous: DictationTarget | null = null;
      for (let i = focusOrder.length - 1; i >= 0; i--) {
        const candidate = targets.get(focusOrder[i]);
        if (!candidate) continue;
        previous = candidate;
        break;
      }
      const index = focusOrder.indexOf(targetId);
      if (index >= 0) focusOrder.splice(index, 1);
      focusOrder.push(targetId);
      if (pending) {
        // An editor took the caret mid-hand-off: the wait is over, its
        // dictated history starts clean, and the queued lines land in it
        // exactly as live lines would.
        if (pending.timer) clearTimeout(pending.timer);
        handoff = null;
        target.resetScratch?.();
        for (const line of pending.queue) applyFinishedLine(line, target);
        return;
      }
      if (previous && previous.id !== targetId) {
        // Scratch history never reaches into another editor.
        previous.resetScratch?.();
        if (partial) {
          if (!previous.secret) previous.showPartial("");
          const next = targets.get(targetId);
          if (next && !next.secret) next.showPartial(partial);
        }
      }
    },
    async toggle() {
      if (snapshot.status === "idle") await start();
      else await stop();
    },
    start,
    stop,
    async setLanguage(language) {
      override = language;
      if (snapshot.status === "idle") return;
      await stop();
      await start();
    },
    languageOverride: () => override,
  };
}
