// The one Dictation Session per app (framework-free, like the Edit Session).
// It knows targets (editors), a language, and a RecognizerHost; it never
// knows which engine or platform is underneath.
import type { LineStats } from "@/features/dictation/stats";
import type { RouteResult } from "@/features/dictation/router";
import {
  toDictationError,
  type DictationErrorCode,
  type DictationEvent,
  type DictationLanguage,
  type ModelSpec,
  type RecognizerHost,
} from "@/features/dictation/types";

export interface DictationTarget {
  id: string;
  language(): DictationLanguage;
  /** Shows the in-progress line; "" clears it. Never changes the document. */
  showPartial(text: string): void;
  /** Inserts a finished line at the caret as one undo step. */
  commit(text: string): void;
}

export type SessionStatus = "idle" | "loading" | "listening" | "stopping";

export type SessionNotice =
  | { kind: "started"; language: DictationLanguage }
  | { kind: "stopped" }
  | { kind: "error"; code: DictationErrorCode; language?: DictationLanguage }
  | { kind: "orphan_copied" };

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

export function createDictationSession(deps: {
  host: RecognizerHost;
  modelFor: (language: DictationLanguage) => ModelSpec | null;
  route: (text: string) => RouteResult;
  runCommand: (id: string) => void;
  notify: (notice: SessionNotice) => void;
  copyText: (text: string) => Promise<void>;
  stats: LineStats;
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
        const result = deps.route(event.text);
        if (result.kind === "command") {
          deps.runCommand(result.id);
          return;
        }
        const target = active();
        if (target) target.commit(result.text);
        else {
          void deps.copyText(result.text);
          deps.notify({ kind: "orphan_copied" });
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
        if (stopRequested) {
          set({ status: "idle", level: 0 });
          return;
        }
        await deps.host.start(onEvent);
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
        else if (
          snapshot.status === "listening" ||
          snapshot.status === "loading"
        )
          void stop();
      };
    },
    focus(targetId) {
      if (!targets.has(targetId)) return;
      const previous = active();
      const index = focusOrder.indexOf(targetId);
      if (index >= 0) focusOrder.splice(index, 1);
      focusOrder.push(targetId);
      if (previous && previous.id !== targetId && partial) {
        previous.showPartial("");
        targets.get(targetId)?.showPartial(partial);
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
      if (snapshot.status !== "listening") return;
      await stop();
      await start();
    },
    languageOverride: () => override,
  };
}
