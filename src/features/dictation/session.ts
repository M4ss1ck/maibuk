// The one Dictation Session per app (framework-free, like the Edit Session).
// It knows targets (editors), a language, and a RecognizerHost; it never
// knows which engine or platform is underneath.
import type { LineStats } from "@/features/dictation/stats";
import type { DictationEdit, RouteResult } from "@/features/dictation/router";
import { findSentenceStartOffset } from "@/features/dictation/interpreter";
import type { VoiceCommandRun } from "@/features/dictation/voice-commands";
import {
  toDictationError,
  type DictationErrorCode,
  type DictationEvent,
  type DictationLanguage,
  type ModelSpec,
  type RecognizerHost,
} from "@/features/dictation/types";

/** What a scratch request did on its target. `refused` means the author edited inside the dictated text. */
export type ScratchOutcome = "removed" | "refused" | "empty";

export interface DictationTarget {
  id: string;
  language(): DictationLanguage;
  /** Shows the in-progress line; "" clears it. Never changes the document. */
  showPartial(text: string): void;
  /** At most 256 characters before the caret; never the whole document. */
  before(): string;
  /** Applies one finished line as one undo step. */
  apply(edits: DictationEdit[]): void;
  /**
   * Runs one Voice Command on this target's editor; true when it ran. The
   * polarity picks a mark's set or unset runner. Absent targets run none.
   */
  voice?(run: VoiceCommandRun): boolean;
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
  | ({ kind: "voice_command" } & VoiceCommandRun);

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

export function createDictationSession(deps: {
  host: RecognizerHost;
  modelFor: (language: DictationLanguage) => ModelSpec | null;
  route: (text: string, before: string) => RouteResult;
  /** False while the Tutorial runs: no Voice Command may act (ADR 0008), like Shortcuts. */
  voiceCommandsAllowed?: () => boolean;
  notify: (notice: SessionNotice) => void;
  copyText: (text: string) => Promise<void>;
  stats: LineStats;
  isEnabled?: () => boolean;
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
      if (target) return target;
    }
    return null;
  };

  const showPartial = (text: string) => {
    partial = text;
    active()?.showPartial(text);
  };

  const onEvent = (event: DictationEvent) => {
    switch (event.type) {
      case "level":
        set({ level: event.rms });
        return;
      case "partial":
        showPartial(event.text);
        return;
      case "final": {
        showPartial("");
        deps.stats.record(event.latencyMs);
        const target = active();
        const startedAt = performance.now();
        const result = deps.route(event.text, target?.before() ?? "");
        const interpreterMs = performance.now() - startedAt;
        // The Tutorial gate is the Shortcuts one: while a run is under way no
        // Voice Command acts, and its words are never inserted either. Only a
        // Command that really ran counts.
        const voiceRan =
          result.kind === "voice_command" &&
          deps.voiceCommandsAllowed?.() !== false &&
          target?.voice?.({ id: result.id, polarity: result.polarity }) === true;
        deps.stats.recordInterpreter(
          interpreterMs,
          result.kind === "edits" ? (result.spokenPunctuationCount ?? 0) : 0,
          result.kind === "scratch" ? 1 : 0,
          voiceRan ? 1 : 0
        );
        if (result.kind === "voice_command") {
          if (voiceRan) {
            deps.notify({ kind: "voice_command", id: result.id, polarity: result.polarity });
          }
          return;
        }
        if (result.kind === "scratch") {
          const outcome = target?.scratch?.() ?? "empty";
          if (outcome === "refused") deps.notify({ kind: "scratch_refused" });
          else if (outcome === "empty") deps.notify({ kind: "scratch_empty" });
          return;
        }
        if (target) target.apply(result.edits);
        else {
          const text = editsToOrphanText(result.edits);
          deps.copyText(text).then(
            () => deps.notify({ kind: "orphan_copied" }),
            () => deps.notify({ kind: "orphan_lost", text })
          );
        }
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
        if (next) next.showPartial(partial);
        else if (snapshot.status === "listening" || snapshot.status === "loading") void stop();
      };
    },
    focus(targetId) {
      if (!targets.has(targetId)) return;
      const previous = active();
      const index = focusOrder.indexOf(targetId);
      if (index >= 0) focusOrder.splice(index, 1);
      focusOrder.push(targetId);
      if (previous && previous.id !== targetId) {
        // Scratch history never reaches into another editor.
        previous.resetScratch?.();
        if (partial) {
          previous.showPartial("");
          targets.get(targetId)?.showPartial(partial);
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
