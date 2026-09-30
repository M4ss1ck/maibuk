import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  createDictationSession,
  HANDOFF_LIMIT_MS,
  type DictationTarget,
  type SessionNotice,
} from "@/features/dictation/session";
import type { CommandRunOutcome } from "@/lib/command-runner";
import type { CommandId } from "@/lib/shortcut-registry";
import { createRouter, type RouteResult } from "@/features/dictation/router";
import { createLineStats } from "@/features/dictation/stats";
import {
  DictationError,
  type DictationEvent,
  type ModelSpec,
  type RecognizerHost,
} from "@/features/dictation/types";

const model = (lang: "en" | "es"): ModelSpec => ({
  id: `m-${lang}`,
  engine: "moonshine",
  languages: [lang],
  tier: "fast",
  platforms: ["web"],
  files: [],
  engineOptions: {},
  capabilities: { casing: true, punctuation: true, streaming: true },
});

function fakeHost() {
  let listener: ((e: DictationEvent) => void) | null = null;
  let releaseLoad: (() => void) | null = null;
  const host = {
    loads: [] as string[],
    starts: 0,
    holdLoad: false,
    emit: (e: DictationEvent) => listener?.(e),
    finishLoad: () => releaseLoad?.(),
    isSupported: vi.fn(async () => ({ supported: true })),
    load: vi.fn(async (spec: ModelSpec) => {
      host.loads.push(spec.id);
      if (host.holdLoad) await new Promise<void>((r) => (releaseLoad = r));
    }),
    start: vi.fn(async (l: (e: DictationEvent) => void) => {
      host.starts += 1;
      listener = l;
    }),
    stop: vi.fn(async () => {
      listener?.({ type: "final", text: "flushed", latencyMs: 10 });
      listener = null;
    }),
    setContext: vi.fn(async () => {}),
    inputDevice: vi.fn(async () => null),
    dispose: vi.fn(async () => {}),
  };
  return host satisfies RecognizerHost & object;
}

function fakeTarget(id: string, language: "en" | "es" = "es") {
  const target: DictationTarget & { partials: string[]; commits: string[] } = {
    id,
    partials: [],
    commits: [],
    language: () => language,
    showPartial: (text) => void target.partials.push(text),
    before: () => "",
    apply: (edits) =>
      void target.commits.push(
        edits.map((edit) => (edit.kind === "text" ? edit.text : "\n")).join("")
      ),
  };
  return target;
}

let host: ReturnType<typeof fakeHost>;
let notices: SessionNotice[];
let copied: string[];
let copyText: (text: string) => Promise<void>;
let models: Record<string, ModelSpec | null>;
let enabled: boolean;

function makeSession() {
  return createDictationSession({
    host,
    modelFor: (lang) => models[lang] ?? null,
    route: createRouter(),
    notify: (n) => void notices.push(n),
    copyText: (t) => copyText(t),
    stats: createLineStats(),
    isEnabled: () => enabled,
  });
}

beforeEach(() => {
  enabled = true;
  host = fakeHost();
  notices = [];
  copied = [];
  copyText = async (t) => void copied.push(t);
  models = { es: model("es"), en: model("en") };
});

describe("Dictation Session", () => {
  it("releases a microphone whose start finishes after Dictation is turned off", async () => {
    let release = () => {};
    host.start.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const session = makeSession();
    session.register(fakeTarget("chapter"));
    session.focus("chapter");
    const starting = session.start();
    await vi.waitFor(() => expect(host.start).toHaveBeenCalled());
    enabled = false;
    const stopping = session.stop();
    release();
    await Promise.all([starting, stopping]);
    expect(host.stop).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().status).toBe("idle");
    expect(notices).not.toContainEqual({ kind: "started", language: "es" });
  });

  it("does not open the microphone if disabled while the model loads", async () => {
    host.holdLoad = true;
    const session = makeSession();
    session.register(fakeTarget("chapter"));
    session.focus("chapter");
    const starting = session.start();
    enabled = false;
    const stopping = session.stop();
    host.finishLoad();
    await Promise.all([starting, stopping]);
    expect(host.start).not.toHaveBeenCalled();
    expect(session.getSnapshot().status).toBe("idle");
  });
  // Editors re-register whenever TipTap recreates them; a notification for
  // every register re-rendered them into a loop that stalled route changes.
  it("notifies only when the snapshot actually changes", () => {
    const session = makeSession();
    const listener = vi.fn();
    session.subscribe(listener);
    const unregisterA = session.register(fakeTarget("a", "es"));
    const calls = listener.mock.calls.length;
    const before = session.getSnapshot();
    const unregisterB = session.register(fakeTarget("b", "es"));
    unregisterB();
    session.register(fakeTarget("b", "es"));
    expect(listener).toHaveBeenCalledTimes(calls);
    expect(session.getSnapshot()).toBe(before);
    unregisterA();
  });

  it("does nothing without a target and says why", async () => {
    const session = makeSession();
    await session.toggle();
    expect(session.getSnapshot().status).toBe("idle");
    expect(notices).toEqual([{ kind: "error", code: "no_target" }]);
    expect(host.load).not.toHaveBeenCalled();
  });

  it("starts in the target's language and inserts finals at the target", async () => {
    const session = makeSession();
    const target = fakeTarget("a", "es");
    session.register(target);
    session.focus("a");
    await session.toggle();
    expect(session.getSnapshot()).toMatchObject({
      status: "listening",
      language: "es",
      modelId: "m-es",
    });
    expect(notices).toContainEqual({ kind: "started", language: "es" });
    host.emit({ type: "partial", text: "hola" });
    host.emit({ type: "final", text: "hola mundo", latencyMs: 40 });
    expect(target.partials).toEqual(["hola", ""]);
    expect(target.commits).toEqual(["hola mundo"]);
  });

  it("reports a missing model and stays idle", async () => {
    models.es = null;
    const session = makeSession();
    session.register(fakeTarget("a", "es"));
    session.focus("a");
    await session.start();
    expect(session.getSnapshot().status).toBe("idle");
    expect(notices).toEqual([{ kind: "error", code: "model_missing", language: "es" }]);
  });

  it("stop flushes the last final into the target before going idle", async () => {
    const session = makeSession();
    const target = fakeTarget("a");
    session.register(target);
    session.focus("a");
    await session.start();
    await session.stop();
    expect(target.commits).toEqual(["flushed"]);
    expect(session.getSnapshot().status).toBe("idle");
    expect(notices.at(-1)).toEqual({ kind: "stopped" });
  });

  it("follows focus: the partial moves and the next final lands in the new target", async () => {
    const session = makeSession();
    const chapter = fakeTarget("chapter");
    const quickNote = fakeTarget("quick");
    session.register(chapter);
    session.register(quickNote);
    session.focus("chapter");
    await session.start();
    host.emit({ type: "partial", text: "uno" });
    session.focus("quick");
    host.emit({ type: "final", text: "uno dos" });
    expect(chapter.partials).toEqual(["uno", ""]);
    expect(quickNote.partials).toEqual(["uno", ""]);
    expect(quickNote.commits).toEqual(["uno dos"]);
    expect(chapter.commits).toEqual([]);
  });

  it("retargets to the last focused editor still mounted when the active one unmounts", async () => {
    const session = makeSession();
    const chapter = fakeTarget("chapter");
    const quickNote = fakeTarget("quick");
    session.register(chapter);
    const unregisterQuick = session.register(quickNote);
    session.focus("chapter");
    session.focus("quick");
    await session.start();
    unregisterQuick();
    host.emit({ type: "final", text: "sigue" });
    expect(chapter.commits).toEqual(["sigue"]);
    expect(session.getSnapshot().status).toBe("listening");
  });

  it("orphaned final is copied, session idles", async () => {
    const session = makeSession();
    const unregister = session.register(fakeTarget("a"));
    session.focus("a");
    await session.start();
    unregister();
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe("idle"));
    expect(copied).toEqual(["flushed"]);
    expect(notices).toContainEqual({ kind: "orphan_copied" });
  });

  it("orphaned opener goes at its sentence start, not next to the closing mark", async () => {
    const { editsToOrphanText } = await import("@/features/dictation/session");
    expect(
      editsToOrphanText([
        { kind: "text", text: "Qué hora es" },
        { kind: "opener", mark: "¿" },
        { kind: "text", text: "?" },
      ])
    ).toBe("¿Qué hora es?");
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(() => ({
        kind: "edits",
        edits: [
          { kind: "text", text: "Qué hora es" },
          { kind: "opener", mark: "¿" },
          { kind: "text", text: "?" },
        ],
        spokenPunctuationCount: 1,
      })),
      notify: (n) => void notices.push(n),
      copyText: (t) => copyText(t),
      stats: createLineStats(),
    });
    const unregister = session.register(fakeTarget("a"));
    session.focus("a");
    await session.start();
    unregister();
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe("idle"));
    expect(copied).toEqual(["¿Qué hora es?"]);
    expect(notices).toContainEqual({ kind: "orphan_copied" });
  });

  it("orphaned final that cannot be copied is handed back, never reported as copied", async () => {
    copyText = () => Promise.reject(new Error("Document is not focused"));
    const session = makeSession();
    const unregister = session.register(fakeTarget("a"));
    session.focus("a");
    await session.start();
    unregister();
    await vi.waitFor(() =>
      expect(notices).toContainEqual({ kind: "orphan_lost", text: "flushed" })
    );
    expect(notices).not.toContainEqual({ kind: "orphan_copied" });
    expect(session.getSnapshot().status).toBe("idle");
  });

  it("toggle during loading stops after load without starting the engine", async () => {
    host.holdLoad = true;
    const session = makeSession();
    session.register(fakeTarget("a"));
    session.focus("a");
    const starting = session.toggle();
    expect(session.getSnapshot().status).toBe("loading");
    const stopping = session.toggle();
    host.finishLoad();
    await Promise.all([starting, stopping]);
    expect(host.starts).toBe(0);
    expect(session.getSnapshot().status).toBe("idle");
  });

  it("a double start runs the engine once", async () => {
    const session = makeSession();
    session.register(fakeTarget("a"));
    session.focus("a");
    await Promise.all([session.start(), session.start()]);
    expect(host.starts).toBe(1);
  });

  it("an engine error stops the session and is reported", async () => {
    const session = makeSession();
    session.register(fakeTarget("a"));
    session.focus("a");
    await session.start();
    host.emit({ type: "error", code: "mic_unavailable" });
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe("idle"));
    expect(notices).toContainEqual({ kind: "error", code: "mic_unavailable" });
  });

  it("a load failure is reported with its code and leaves the session idle", async () => {
    host.load.mockRejectedValueOnce(new DictationError("model_corrupt"));
    const session = makeSession();
    session.register(fakeTarget("a"));
    session.focus("a");
    await session.start();
    expect(session.getSnapshot().status).toBe("idle");
    expect(notices).toContainEqual({ kind: "error", code: "model_corrupt" });
  });

  it("switching language mid-session restarts with the other model", async () => {
    const session = makeSession();
    session.register(fakeTarget("a", "es"));
    session.focus("a");
    await session.start();
    await session.setLanguage("en");
    expect(host.loads).toEqual(["m-es", "m-en"]);
    expect(session.getSnapshot()).toMatchObject({
      status: "listening",
      language: "en",
    });
  });

  it("switching language while loading starts only the newly selected model", async () => {
    host.holdLoad = true;
    const session = makeSession();
    session.register(fakeTarget("a", "es"));
    session.focus("a");
    const starting = session.start();
    const switching = session.setLanguage("en");
    host.holdLoad = false;
    host.finishLoad();
    await Promise.all([starting, switching]);
    expect(host.loads).toEqual(["m-es", "m-en"]);
    expect(host.starts).toBe(1);
    expect(session.getSnapshot()).toMatchObject({ status: "listening", language: "en" });
  });

  it("runs a Voice Command on the active target instead of inserting its words", async () => {
    const voice = vi.fn(() => "ran" as const);
    const target = { ...fakeTarget("a"), voice };
    const stats = createLineStats();
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(() => ({
        kind: "voice_command",
        id: "common.undo",
        polarity: null,
      })),
      notify: (n) => void notices.push(n),
      copyText: async () => {},
      stats,
    });
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "deshacer eso" });
    expect(voice).toHaveBeenCalledWith({ id: "common.undo", polarity: null });
    expect(target.commits).toEqual([]);
    expect(notices).toContainEqual({
      kind: "voice_command",
      id: "common.undo",
      polarity: null,
    });
    expect(stats.summary().voiceCommandCount).toBe(1);
    expect(stats.summary().spokenPunctuationCount).toBe(0);
  });

  it("stays silent and counts nothing when the runner did not run", async () => {
    const voice = vi.fn(() => "ignored" as const);
    const target = { ...fakeTarget("a"), voice };
    const stats = createLineStats();
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(() => ({ kind: "voice_command", id: "common.undo", polarity: null })),
      notify: (n) => void notices.push(n),
      copyText: async () => {},
      stats,
    });
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "deshacer eso" });
    expect(voice).toHaveBeenCalledTimes(1);
    expect(notices).not.toContainEqual(expect.objectContaining({ kind: "voice_command" }));
    expect(stats.summary().voiceCommandCount).toBe(0);
  });

  it("announces an empty action without counting it as a run", async () => {
    const voice = vi.fn(() => "empty" as const);
    const target = { ...fakeTarget("a"), voice };
    const stats = createLineStats();
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(() => ({ kind: "voice_command", id: "common.undo", polarity: null })),
      notify: (n) => void notices.push(n),
      copyText: async () => {},
      stats,
    });
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "deshacer eso" });
    expect(notices).toContainEqual({ kind: "voice_command_empty", id: "common.undo" });
    expect(stats.summary().voiceCommandCount).toBe(0);
  });

  it("blocks Voice Commands while the Tutorial runs, without inserting them", async () => {
    const voice = vi.fn(() => "ran" as const);
    const target = { ...fakeTarget("a"), voice };
    const stats = createLineStats();
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(() => ({ kind: "voice_command", id: "editor.bold", polarity: "on" })),
      voiceCommandsAllowed: () => false,
      notify: (n) => void notices.push(n),
      copyText: async () => {},
      stats,
    });
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "poner negrita" });
    expect(voice).not.toHaveBeenCalled();
    expect(target.commits).toEqual([]);
    expect(notices).not.toContainEqual(expect.objectContaining({ kind: "voice_command" }));
    expect(notices).toContainEqual({
      kind: "voice_command_refused",
      id: "editor.bold",
      reason: "tutorial",
    });
    expect(stats.summary().voiceCommandCount).toBe(0);
    expect(stats.summary().voiceCommandRefusedCount).toBe(1);
  });

  it("does not apply a scratch request", async () => {
    const target = fakeTarget("a");
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(() => ({ kind: "scratch" })),
      notify: () => {},
      copyText: async () => {},
      stats: createLineStats(),
    });
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "borra eso" });
    expect(target.commits).toEqual([]);
  });

  it("runs scratch on the active target and announces a refusal", async () => {
    const stats = createLineStats();
    const scratch = vi.fn(() => "refused" as const);
    const target = { ...fakeTarget("a"), scratch };
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(() => ({ kind: "scratch" })),
      notify: (n) => void notices.push(n),
      copyText: async () => {},
      stats,
    });
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "borra eso" });
    expect(scratch).toHaveBeenCalledTimes(1);
    expect(target.commits).toEqual([]);
    expect(notices).toContainEqual({ kind: "scratch_refused" });
    expect(stats.summary().scratchCount).toBe(1);
  });

  it("counts a removed scratch without notifying", async () => {
    const stats = createLineStats();
    const scratch = vi.fn(() => "removed" as const);
    const target = { ...fakeTarget("a"), scratch };
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(() => ({ kind: "scratch" })),
      notify: (n) => void notices.push(n),
      copyText: async () => {},
      stats,
    });
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "borra eso" });
    expect(stats.summary().scratchCount).toBe(1);
    expect(notices).not.toContainEqual({ kind: "scratch_refused" });
  });

  it("announces an empty scratch without touching the editor", async () => {
    const stats = createLineStats();
    const scratch = vi.fn(() => "empty" as const);
    const target = { ...fakeTarget("a"), scratch };
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(() => ({ kind: "scratch" })),
      notify: (n) => void notices.push(n),
      copyText: async () => {},
      stats,
    });
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "borra eso" });
    expect(scratch).toHaveBeenCalledTimes(1);
    expect(target.commits).toEqual([]);
    expect(notices).toContainEqual({ kind: "scratch_empty" });
    expect(stats.summary().scratchCount).toBe(1);
  });

  it("announces an empty scratch when the target cannot scratch", async () => {
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(() => ({ kind: "scratch" })),
      notify: (n) => void notices.push(n),
      copyText: async () => {},
      stats: createLineStats(),
    });
    session.register(fakeTarget("a"));
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "borra eso" });
    expect(notices).toContainEqual({ kind: "scratch_empty" });
  });

  it("resets the previous target's history when focus moves editors", async () => {
    const resetA = vi.fn();
    const resetB = vi.fn();
    const session = makeSession();
    session.register({ ...fakeTarget("a"), resetScratch: resetA });
    session.register({ ...fakeTarget("b"), resetScratch: resetB });
    session.focus("a");
    session.focus("b");
    expect(resetA).toHaveBeenCalledTimes(1);
    expect(resetB).not.toHaveBeenCalled();
    session.focus("b");
    expect(resetA).toHaveBeenCalledTimes(1);
  });

  it("resets an unavailable previous target's history when focus moves", async () => {
    const resetField = vi.fn();
    const session = makeSession();
    // A field that lost the caret reports unavailable, but it is still
    // registered: taking focus elsewhere must still drop its history.
    session.register({
      ...fakeTarget("field"),
      resetScratch: resetField,
      isAvailable: () => false,
    });
    session.register({ ...fakeTarget("b"), resetScratch: vi.fn() });
    session.focus("field");
    session.focus("b");
    expect(resetField).toHaveBeenCalledTimes(1);
  });

  it("level events update the snapshot and notify subscribers", async () => {
    const session = makeSession();
    const listener = vi.fn();
    session.subscribe(listener);
    session.register(fakeTarget("a"));
    session.focus("a");
    await session.start();
    host.emit({ type: "level", rms: 0.3 });
    expect(session.getSnapshot().level).toBe(0.3);
    expect(listener).toHaveBeenCalled();
  });

  it("passes that through and announces a ran that run as a voice command", async () => {
    const voice = vi.fn(() => "ran" as const);
    const target = { ...fakeTarget("a"), voice };
    const stats = createLineStats();
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(() => ({
        kind: "voice_command",
        id: "editor.bold",
        polarity: "on",
        that: true,
      })),
      notify: (n) => void notices.push(n),
      copyText: async () => {},
      stats,
    });
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "ponlo en negrita", latencyMs: 5 });
    expect(voice).toHaveBeenCalledWith({ id: "editor.bold", polarity: "on", that: true });
    expect(notices).toContainEqual({
      kind: "voice_command",
      id: "editor.bold",
      polarity: "on",
      that: true,
    });
    expect(stats.summary().voiceCommandCount).toBe(1);
  });

  it("announces a refused that run without counting it", async () => {
    const voice = vi.fn(() => "refused" as const);
    const target = { ...fakeTarget("a"), voice };
    const stats = createLineStats();
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(() => ({
        kind: "voice_command",
        id: "editor.bold",
        polarity: "on",
        that: true,
      })),
      notify: (n) => void notices.push(n),
      copyText: async () => {},
      stats,
    });
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "ponlo en negrita", latencyMs: 5 });
    expect(notices).toContainEqual({ kind: "voice_that_refused" });
    expect(notices).not.toContainEqual(expect.objectContaining({ kind: "voice_command" }));
    expect(stats.summary().voiceCommandCount).toBe(0);
  });

  it("announces an empty that run without counting it", async () => {
    const voice = vi.fn(() => "empty" as const);
    const target = { ...fakeTarget("a"), voice };
    const stats = createLineStats();
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(() => ({
        kind: "voice_command",
        id: "editor.bold",
        polarity: "on",
        that: true,
      })),
      notify: (n) => void notices.push(n),
      copyText: async () => {},
      stats,
    });
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "ponlo en negrita", latencyMs: 5 });
    expect(notices).toContainEqual({ kind: "voice_that_empty" });
    expect(stats.summary().voiceCommandCount).toBe(0);
  });

  it("stays silent when a that run is ignored", async () => {
    const voice = vi.fn(() => "ignored" as const);
    const target = { ...fakeTarget("a"), voice };
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(() => ({
        kind: "voice_command",
        id: "editor.bold",
        polarity: "on",
        that: true,
      })),
      notify: (n) => void notices.push(n),
      copyText: async () => {},
      stats: createLineStats(),
    });
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "ponlo en negrita", latencyMs: 5 });
    expect(notices).not.toContainEqual(expect.objectContaining({ kind: "voice_that_refused" }));
    expect(notices).not.toContainEqual(expect.objectContaining({ kind: "voice_that_empty" }));
    expect(notices).not.toContainEqual(expect.objectContaining({ kind: "voice_command" }));
  });

  it("notifies nothing when a non-that run is refused", async () => {
    const voice = vi.fn(() => "refused" as const);
    const target = { ...fakeTarget("a"), voice };
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(() => ({ kind: "voice_command", id: "editor.bold", polarity: "on" })),
      notify: (n) => void notices.push(n),
      copyText: async () => {},
      stats: createLineStats(),
    });
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "ponlo en negrita", latencyMs: 5 });
    expect(voice).toHaveBeenCalledWith({ id: "editor.bold", polarity: "on" });
    expect(notices).not.toContainEqual(expect.objectContaining({ kind: "voice_command" }));
    expect(notices).not.toContainEqual(
      expect.objectContaining({ kind: "voice_that_refused" })
    );
  });
});

describe("Dictation Session Command Runner voice commands (#316)", () => {
  function runnerSession({
    runCommand,
    isEditorCommand,
    voiceCommandsAllowed,
  }: {
    runCommand?: (id: CommandId) => Promise<CommandRunOutcome>;
    isEditorCommand?: (id: CommandId) => boolean;
    voiceCommandsAllowed?: () => boolean;
  }) {
    const voice = vi.fn(() => "ran" as const);
    const target = { ...fakeTarget("a"), voice };
    const stats = createLineStats();
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(() => ({ kind: "voice_command", id: "bookList.newBook", polarity: null })),
      voiceCommandsAllowed,
      runCommand,
      isEditorCommand,
      notify: (n) => void notices.push(n),
      copyText: async () => {},
      stats,
    });
    return { session, target, voice, stats, runCommand };
  }

  it("runs a non-editor voice command through runCommand and announces it", async () => {
    const stub = vi.fn(async () => "ran" as const);
    const { session, target, voice, stats } = runnerSession({
      runCommand: stub,
      isEditorCommand: () => false,
    });
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "new book", latencyMs: 5 });
    expect(stub).toHaveBeenCalledWith("bookList.newBook");
    await vi.waitFor(() =>
      expect(notices).toContainEqual({
        kind: "voice_command",
        id: "bookList.newBook",
        polarity: null,
      })
    );
    expect(voice).not.toHaveBeenCalled();
    expect(target.commits).toEqual([]);
    expect(stats.summary().voiceCommandCount).toBe(1);
  });

  it("announces an unavailable voice command and counts it without inserting", async () => {
    const stub = vi.fn(async () => "unavailable" as const);
    const { session, target, stats } = runnerSession({
      runCommand: stub,
      isEditorCommand: () => false,
    });
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "new book", latencyMs: 5 });
    expect(target.commits).toEqual([]);
    await vi.waitFor(() =>
      expect(notices).toContainEqual({
        kind: "voice_command_unavailable",
        id: "bookList.newBook",
      })
    );
    expect(stats.summary().voiceCommandCount).toBe(0);
    expect(stats.summary().voiceCommandUnavailableCount).toBe(1);
  });

  it("announces a dialog-refused voice command and counts it without inserting", async () => {
    const stub = vi.fn(async () => "refused-dialog" as const);
    const { session, target, stats } = runnerSession({
      runCommand: stub,
      isEditorCommand: () => false,
    });
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "new book", latencyMs: 5 });
    expect(target.commits).toEqual([]);
    await vi.waitFor(() =>
      expect(notices).toContainEqual({
        kind: "voice_command_refused",
        id: "bookList.newBook",
        reason: "dialog",
      })
    );
    expect(stats.summary().voiceCommandRefusedCount).toBe(1);
  });

  it("announces a tutorial-refused voice command and counts it without inserting", async () => {
    const stub = vi.fn(async () => "refused-tutorial" as const);
    const { session, target, stats } = runnerSession({
      runCommand: stub,
      isEditorCommand: () => false,
    });
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "new book", latencyMs: 5 });
    expect(target.commits).toEqual([]);
    await vi.waitFor(() =>
      expect(notices).toContainEqual({
        kind: "voice_command_refused",
        id: "bookList.newBook",
        reason: "tutorial",
      })
    );
    expect(stats.summary().voiceCommandRefusedCount).toBe(1);
  });

  it("announces a stuck-dialog refusal and counts it without inserting", async () => {
    const stub = vi.fn(async () => "refused-dialog-close" as const);
    const { session, target, stats } = runnerSession({
      runCommand: stub,
      isEditorCommand: () => false,
    });
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "new book", latencyMs: 5 });
    expect(target.commits).toEqual([]);
    await vi.waitFor(() =>
      expect(notices).toContainEqual({
        kind: "voice_command_refused",
        id: "bookList.newBook",
        reason: "dialog_refused",
      })
    );
    expect(stats.summary().voiceCommandCount).toBe(0);
    expect(stats.summary().voiceCommandRefusedCount).toBe(1);
  });

  it("still runs an editor-keymap command on the target instead of runCommand", async () => {
    const stub = vi.fn(async () => "ran" as const);
    const voice = vi.fn(() => "ran" as const);
    const target = { ...fakeTarget("a"), voice };
    const stats = createLineStats();
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(() => ({ kind: "voice_command", id: "common.undo", polarity: null })),
      runCommand: stub,
      isEditorCommand: () => true,
      notify: (n) => void notices.push(n),
      copyText: async () => {},
      stats,
    });
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "deshacer eso", latencyMs: 5 });
    expect(stub).not.toHaveBeenCalled();
    expect(voice).toHaveBeenCalledWith({ id: "common.undo", polarity: null });
    expect(notices).toContainEqual({
      kind: "voice_command",
      id: "common.undo",
      polarity: null,
    });
  });

  it("announces a tutorial refusal for an editor command while the Tutorial blocks", async () => {
    const voice = vi.fn(() => "ran" as const);
    const target = { ...fakeTarget("a"), voice };
    const stats = createLineStats();
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(() => ({ kind: "voice_command", id: "common.undo", polarity: null })),
      voiceCommandsAllowed: () => false,
      isEditorCommand: () => true,
      notify: (n) => void notices.push(n),
      copyText: async () => {},
      stats,
    });
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "deshacer eso", latencyMs: 5 });
    expect(voice).not.toHaveBeenCalled();
    expect(target.commits).toEqual([]);
    expect(notices).toContainEqual({
      kind: "voice_command_refused",
      id: "common.undo",
      reason: "tutorial",
    });
    expect(stats.summary().voiceCommandRefusedCount).toBe(1);
  });

  it("announces unavailable when the editor target has no voice runner", async () => {
    const stats = createLineStats();
    const target = fakeTarget("a");
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(() => ({ kind: "voice_command", id: "common.undo", polarity: null })),
      isEditorCommand: () => true,
      notify: (n) => void notices.push(n),
      copyText: async () => {},
      stats,
    });
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "deshacer eso", latencyMs: 5 });
    expect(target.commits).toEqual([]);
    expect(notices).toContainEqual({ kind: "voice_command_unavailable", id: "common.undo" });
    expect(stats.summary().voiceCommandUnavailableCount).toBe(1);
  });
});

describe("Dictation Session all-caps lock (#271)", () => {  it("notifies when a line turns the lock on", async () => {
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(() => ({ kind: "edits", edits: [], capsLock: true })),
      notify: (n) => void notices.push(n),
      copyText: (t) => copyText(t),
      stats: createLineStats(),
    });
    const target = fakeTarget("a");
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "all caps on", latencyMs: 5 });
    expect(target.commits).toEqual([""]);
    expect(notices).toContainEqual({ kind: "caps_lock", on: true });
  });

  it("copies nothing orphaned for a line that only changed the lock", async () => {
    const copy = vi.fn(async (_text: string) => {});
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(() => ({ kind: "edits", edits: [], capsLock: true })),
      notify: (n) => void notices.push(n),
      copyText: copy,
      stats: createLineStats(),
    });
    const unregister = session.register(fakeTarget("a"));
    session.focus("a");
    await session.start();
    unregister();
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe("idle"));
    expect(copy).not.toHaveBeenCalled();
    expect(notices).not.toContainEqual({ kind: "orphan_copied" });
    expect(notices).toContainEqual({ kind: "caps_lock", on: true });
  });
});

describe("Dictation Session navigation hand-off (#320)", () => {
  let resolveRun: ((outcome: CommandRunOutcome) => void) | null;
  let runCommand: Mock<(id: CommandId) => Promise<CommandRunOutcome>>;

  function handoffSession(routeText: (text: string) => RouteResult | null) {
    return createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(routeText),
      runCommand: (...args) => runCommand(...args),
      isEditorCommand: () => false,
      isNavigatingCommand: (id) => id === "global.gotoNotes",
      notify: (n) => void notices.push(n),
      copyText: (t) => copyText(t),
      stats: createLineStats(),
    });
  }

  // "go notes" is the navigating Voice Command; anything else is plain prose.
  const routeForHandoff = (text: string): RouteResult | null =>
    text === "go notes"
      ? { kind: "voice_command", id: "global.gotoNotes", polarity: null }
      : null;

  beforeEach(() => {
    vi.useFakeTimers();
    resolveRun = null;
    runCommand = vi.fn(
      () =>
        new Promise<CommandRunOutcome>((resolve) => {
          resolveRun = resolve;
        })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function flushRuns() {
    for (let i = 0; i < 10 && resolveRun === null; i++) await Promise.resolve();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  }

  it("queues a line mid-window and hands it to the editor that takes the caret", async () => {
    const session = handoffSession(routeForHandoff);
    const oldTarget = fakeTarget("old");
    const unregisterOld = session.register(oldTarget);
    session.focus("old");
    await session.start();
    host.emit({ type: "final", text: "go notes", latencyMs: 5 });
    expect(runCommand).toHaveBeenCalledWith("global.gotoNotes");

    // The route change unmounts the old editor while the run is pending.
    unregisterOld();
    expect(session.getSnapshot().status).toBe("listening");

    // A line finishing mid-window queues instead of routing; partials are
    // shown nowhere.
    host.emit({ type: "partial", text: "hel" });
    host.emit({ type: "final", text: "hello", latencyMs: 5 });
    expect(oldTarget.commits).toEqual([]);
    expect(oldTarget.partials).toEqual([""]);

    const next = fakeTarget("new");
    session.register(next);
    session.focus("new");
    expect(next.commits).toEqual(["hello"]);
    expect(session.getSnapshot().status).toBe("listening");

    resolveRun?.("ran");
    await flushRuns();
    expect(notices).toContainEqual({
      kind: "voice_command",
      id: "global.gotoNotes",
      polarity: null,
    });
    // The window already closed at focus: the timer never starts, and the
    // Session keeps listening past the hand-off wait.
    vi.advanceTimersByTime(HANDOFF_LIMIT_MS + 1000);
    await flushRuns();
    expect(session.getSnapshot().status).toBe("listening");
    expect(copied).toEqual([]);
  });

  it("stops with handoff_no_editor when no editor takes the caret in time", async () => {
    const session = handoffSession(routeForHandoff);
    const unregister = session.register(fakeTarget("old"));
    session.focus("old");
    await session.start();
    host.emit({ type: "final", text: "go notes", latencyMs: 5 });
    unregister();
    host.emit({ type: "final", text: "hello", latencyMs: 5 });

    resolveRun?.("ran");
    await flushRuns();
    vi.advanceTimersByTime(HANDOFF_LIMIT_MS);
    await flushRuns();

    expect(copied).toContain("hello");
    expect(notices).toContainEqual({ kind: "handoff_no_editor" });
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe("idle"));
  });

  it.each(["unavailable", "refused-dialog-close"] as const)(
    "keeps its target with no window when a navigating run ends %s",
    async (outcome) => {
      const session = handoffSession(routeForHandoff);
      const target = fakeTarget("a");
      session.register(target);
      session.focus("a");
      await session.start();
      runCommand.mockResolvedValueOnce(outcome);
      host.emit({ type: "final", text: "go notes", latencyMs: 5 });
      await flushRuns();

      // No window: the next line routes live into the target that never left.
      host.emit({ type: "final", text: "still here", latencyMs: 5 });
      expect(target.commits).toEqual(["still here"]);
      expect(session.getSnapshot().status).toBe("listening");
      vi.advanceTimersByTime(HANDOFF_LIMIT_MS + 1000);
      await flushRuns();
      expect(session.getSnapshot().status).toBe("listening");
      expect(copied).toEqual([]);
    }
  );

  it("keeps listening when a dialog hides the target and refuses a navigating run", async () => {
    const session = handoffSession(routeForHandoff);
    const target = fakeTarget("a");
    let hidden = false;
    target.isAvailable = () => !hidden;
    session.register(target);
    session.focus("a");
    await session.start();
    hidden = true;
    runCommand.mockResolvedValueOnce("refused-dialog-close");
    host.emit({ type: "final", text: "go notes", latencyMs: 5 });
    await flushRuns();

    expect(notices).toContainEqual({
      kind: "voice_command_refused",
      id: "global.gotoNotes",
      reason: "dialog_refused",
    });
    expect(notices).not.toContainEqual({ kind: "stopped" });
    expect(session.getSnapshot().status).toBe("listening");
    expect(target.commits).toEqual([]);
  });

  it("stops as today when the target leaves after a non-navigating run", async () => {
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(
        (text): RouteResult | null =>
          text === "toggle theme"
            ? { kind: "voice_command", id: "global.toggleTheme", polarity: null }
            : null
      ),
      runCommand: vi.fn(async () => "ran" as const),
      isEditorCommand: () => false,
      isNavigatingCommand: (id) => id === "global.gotoNotes",
      notify: (n) => void notices.push(n),
      copyText: (t) => copyText(t),
      stats: createLineStats(),
    });
    const unregister = session.register(fakeTarget("a"));
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "toggle theme", latencyMs: 5 });
    unregister();
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe("idle"));
    expect(copied).toEqual(["flushed"]);
    expect(notices).toContainEqual({ kind: "orphan_copied" });
  });

  it("routes scratch after the hand-off to the new target only, from a clean history", async () => {
    const routeText = (text: string): RouteResult | null =>
      text === "go notes"
        ? { kind: "voice_command", id: "global.gotoNotes", polarity: null }
        : text === "scratch that"
          ? { kind: "scratch" }
          : null;
    const session = handoffSession(routeText);
    const oldScratch = vi.fn(() => "removed" as const);
    const oldReset = vi.fn();
    const unregisterOld = session.register({ ...fakeTarget("old"), scratch: oldScratch, resetScratch: oldReset });
    session.focus("old");
    await session.start();
    host.emit({ type: "final", text: "go notes", latencyMs: 5 });
    unregisterOld();
    host.emit({ type: "final", text: "hello", latencyMs: 5 });

    const newScratch = vi.fn(() => "removed" as const);
    const newReset = vi.fn();
    session.register({ ...fakeTarget("new"), scratch: newScratch, resetScratch: newReset });
    session.focus("new");
    resolveRun?.("ran");
    await flushRuns();

    // "scratch that" after the hand-off reaches only the new editor, whose
    // history was reset when it took the caret.
    host.emit({ type: "final", text: "scratch that", latencyMs: 5 });
    expect(newScratch).toHaveBeenCalledTimes(1);
    expect(oldScratch).not.toHaveBeenCalled();
    expect(newReset).toHaveBeenCalled();
  });

  it("drops the queue when the Session stops mid-window", async () => {
    const session = handoffSession(routeForHandoff);
    const unregister = session.register(fakeTarget("old"));
    session.focus("old");
    await session.start();
    host.emit({ type: "final", text: "go notes", latencyMs: 5 });
    unregister();
    host.emit({ type: "final", text: "hello", latencyMs: 5 });

    await session.stop();
    expect(session.getSnapshot().status).toBe("idle");
    resolveRun?.("ran");
    await flushRuns();
    vi.advanceTimersByTime(HANDOFF_LIMIT_MS + 1000);
    await flushRuns();
    expect(copied).not.toContain("hello");
    expect(notices).not.toContainEqual({ kind: "handoff_no_editor" });
  });

  it("flushes the queue into the old editor when it survives the run", async () => {
    const session = handoffSession(routeForHandoff);
    const target = fakeTarget("a");
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "go notes", latencyMs: 5 });
    // The run kept the route (or the editor): the target never left.
    host.emit({ type: "final", text: "hello", latencyMs: 5 });
    resolveRun?.("ran");
    await flushRuns();
    vi.advanceTimersByTime(HANDOFF_LIMIT_MS);
    await flushRuns();
    expect(target.commits).toEqual(["hello"]);
    expect(session.getSnapshot().status).toBe("listening");
    expect(copied).toEqual([]);
  });
});

describe("Dictation Session Click by Name", () => {
  function clickSession(
    routeText: (text: string) => RouteResult | null,
    click: {
      pressByName: (name: string) => { kind: "pressed"; name: string } | { kind: "choices"; count: number } | { kind: "not_found" };
      pressChoice: (n: number) => { kind: "pressed"; name: string } | { kind: "no_choice" };
      clearChoices: () => void;
      hasChoices: () => boolean;
    },
    stats = createLineStats()
  ) {
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(routeText),
      notify: (n) => void notices.push(n),
      copyText: (t) => copyText(t),
      stats,
      click,
    });
    return { session, stats };
  }

  function stubClick(overrides: Partial<Parameters<typeof clickSession>[1]> = {}) {
    let pending = false;
    return {
      pressByName: vi.fn((name: string) => {
        if (name === "export") return { kind: "pressed" as const, name: "Export" };
        if (name === "duplicate") {
          pending = true;
          return { kind: "choices" as const, count: 2 };
        }
        return { kind: "not_found" as const };
      }),
      pressChoice: vi.fn((n: number) => {
        pending = false;
        return n === 2
          ? { kind: "pressed" as const, name: "Duplicate" }
          : ({ kind: "no_choice" as const });
      }),
      clearChoices: vi.fn(() => {
        pending = false;
      }),
      hasChoices: vi.fn(() => pending),
      ...overrides,
    };
  }

  const clickRoute = (text: string): RouteResult | null =>
    text === "click export"
      ? { kind: "click", name: "export" }
      : text === "click duplicate"
        ? { kind: "click", name: "duplicate" }
        : text === "click two"
          ? { kind: "click_number", n: 2 }
          : text === "click nine"
            ? { kind: "click_number", n: 9 }
            : null;

  it("presses one match and counts it as a run without inserting", async () => {
    const click = stubClick();
    const { session, stats } = clickSession(clickRoute, click);
    const target = fakeTarget("a");
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "click export", latencyMs: 5 });
    expect(click.pressByName).toHaveBeenCalledWith("export");
    expect(target.commits).toEqual([]);
    expect(notices).toContainEqual({ kind: "click_pressed", name: "Export" });
    expect(stats.summary().voiceCommandCount).toBe(1);
  });

  it("lists choices and presses the numbered one", async () => {
    const click = stubClick();
    const { session } = clickSession(clickRoute, click);
    const target = fakeTarget("a");
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "click duplicate", latencyMs: 5 });
    expect(notices).toContainEqual({ kind: "click_choices", count: 2 });
    host.emit({ type: "final", text: "click two", latencyMs: 5 });
    expect(click.pressChoice).toHaveBeenCalledWith(2);
    expect(notices).toContainEqual({ kind: "click_pressed", name: "Duplicate" });
    expect(target.commits).toEqual([]);
  });

  it("announces no match and counts it as unavailable without inserting", async () => {
    const click = stubClick();
    const { session, stats } = clickSession(
      (text) => (text === "click missing" ? { kind: "click", name: "missing" } : null),
      click
    );
    const target = fakeTarget("a");
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "click missing", latencyMs: 5 });
    expect(notices).toContainEqual({ kind: "click_not_found", name: "missing" });
    expect(target.commits).toEqual([]);
    expect(stats.summary().voiceCommandUnavailableCount).toBe(1);
  });

  it("answers a number with no pending choices as a name", async () => {
    const pressByName = vi.fn((_name: string) => ({ kind: "not_found" as const }));
    const click = stubClick({ pressByName, hasChoices: vi.fn(() => false) });
    const { session } = clickSession(clickRoute, click);
    session.register(fakeTarget("a"));
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "click nine", latencyMs: 5 });
    expect(pressByName).toHaveBeenCalledWith("9");
    expect(notices).toContainEqual({ kind: "click_not_found", name: "9" });
  });

  it("clears pending choices on a non-number line and handles it normally", async () => {
    let pending = true;
    const clearChoices = vi.fn(() => {
      pending = false;
    });
    const click = stubClick({ clearChoices, hasChoices: vi.fn(() => pending) });
    const { session } = clickSession(clickRoute, click);
    const target = fakeTarget("a");
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "hello world", latencyMs: 5 });
    expect(clearChoices).toHaveBeenCalledTimes(1);
    expect(target.commits).toEqual(["hello world"]);
  });

  it("reports no_choice for a number with no matching choice", async () => {
    let pending = true;
    const click = stubClick({ hasChoices: vi.fn(() => pending) });
    vi.mocked(click.pressChoice).mockImplementationOnce((_n: number) => {
      pending = false;
      return { kind: "no_choice" as const };
    });
    const { session } = clickSession(clickRoute, click);
    session.register(fakeTarget("a"));
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "click nine", latencyMs: 5 });
    expect(notices).toContainEqual({ kind: "click_not_found", name: "9" });
  });
});

describe("Dictation Session field targets (#313)", () => {
  it("skips an unavailable target: the line goes to the next available one", async () => {
    const session = makeSession();
    const available = fakeTarget("a");
    const applySpy = vi.fn((edits: Parameters<DictationTarget["apply"]>[0]) =>
      available.apply(edits)
    );
    const unavailable = { ...fakeTarget("b"), apply: applySpy, isAvailable: () => false };
    session.register(available);
    session.register(unavailable);
    session.focus("a");
    session.focus("b");
    await session.start();
    host.emit({ type: "final", text: "hello", latencyMs: 5 });
    expect(available.commits).toEqual(["hello"]);
    expect(applySpy).not.toHaveBeenCalled();
  });

  it("takes the orphan path when no target is available, never touching the unavailable one", async () => {
    const session = makeSession();
    const applySpy = vi.fn();
    const unavailable = { ...fakeTarget("b"), apply: applySpy, isAvailable: () => false };
    const unregisterAvailable = session.register(fakeTarget("a"));
    session.register(unavailable);
    session.focus("a");
    session.focus("b");
    await session.start();
    // The Modal over the editor unmounted it: only the hidden target is left.
    unregisterAvailable();
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe("idle"));
    expect(copied).toEqual(["flushed"]);
    expect(notices).toContainEqual({ kind: "orphan_copied" });
    expect(applySpy).not.toHaveBeenCalled();
  });

  it("does not start with only unavailable targets", async () => {
    const session = makeSession();
    session.register({ ...fakeTarget("b"), isAvailable: () => false });
    session.focus("b");
    await session.start();
    expect(session.getSnapshot().status).toBe("idle");
    expect(notices).toEqual([{ kind: "error", code: "no_target" }]);
    expect(host.load).not.toHaveBeenCalled();
  });

  it("refuses dictated text on a secret target without reading, applying, or copying it", async () => {
    const before = vi.fn(() => "s3cr3t");
    const route = vi.fn(
      (): RouteResult => ({ kind: "edits", edits: [{ kind: "text", text: "hello" }] })
    );
    const copy = vi.fn(async (_text: string) => {});
    const applySpy = vi.fn();
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(route),
      notify: (n) => void notices.push(n),
      copyText: copy,
      stats: createLineStats(),
    });
    const secret = {
      ...fakeTarget("pw"),
      before,
      apply: applySpy,
      secret: true as const,
    };
    session.register(secret);
    session.focus("pw");
    await session.start();
    host.emit({ type: "final", text: "hello", latencyMs: 5 });
    expect(route).toHaveBeenCalledWith("hello", "", { verbatim: false });
    expect(before).not.toHaveBeenCalled();
    expect(applySpy).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
    expect(notices).toContainEqual({ kind: "field_secret_refused" });
  });

  it("never shows partials on a secret target", async () => {
    const session = makeSession();
    const secret = { ...fakeTarget("pw"), secret: true as const };
    session.register(secret);
    session.focus("pw");
    await session.start();
    host.emit({ type: "partial", text: "hel" });
    expect(secret.partials).toEqual([]);
  });

  it("announces unavailable for a voice command on a secret target with no voice runner", async () => {
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(() => ({ kind: "voice_command", id: "common.undo", polarity: null })),
      notify: (n) => void notices.push(n),
      copyText: (t) => copyText(t),
      stats: createLineStats(),
    });
    const secret = { ...fakeTarget("pw"), secret: true as const };
    session.register(secret);
    session.focus("pw");
    await session.start();
    host.emit({ type: "final", text: "deshacer eso", latencyMs: 5 });
    expect(secret.commits).toEqual([]);
    expect(notices).toContainEqual({ kind: "voice_command_unavailable", id: "common.undo" });
  });

  it("announces when a field drops layout it cannot hold", async () => {
    const session = makeSession();
    const target = { ...fakeTarget("a"), apply: vi.fn(() => "layout_ignored" as const) };
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "hello", latencyMs: 5 });
    expect(target.apply).toHaveBeenCalled();
    expect(notices).toContainEqual({ kind: "field_layout_ignored" });
  });

  it("announces unavailable when a voice runner cannot run, instead of a run", async () => {
    const voice = vi.fn(() => "unavailable" as const);
    const target = { ...fakeTarget("a"), voice };
    const stats = createLineStats();
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(() => ({ kind: "voice_command", id: "common.undo", polarity: null })),
      notify: (n) => void notices.push(n),
      copyText: async () => {},
      stats,
    });
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "deshacer eso", latencyMs: 5 });
    expect(notices).toContainEqual({ kind: "voice_command_unavailable", id: "common.undo" });
    expect(notices).not.toContainEqual(expect.objectContaining({ kind: "voice_command" }));
    expect(stats.summary().voiceCommandUnavailableCount).toBe(1);
    expect(stats.summary().voiceCommandCount).toBe(0);
  });

  it("passes verbatim through to the route for phrase-editor targets only", async () => {
    const seen: unknown[] = [];
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter((_text, _before, options) => {
        seen.push(options);
        return null;
      }),
      notify: (n) => void notices.push(n),
      copyText: (t) => copyText(t),
      stats: createLineStats(),
    });
    const plain = fakeTarget("plain");
    const verbatimTarget = { ...fakeTarget("phrase"), verbatim: () => true };
    session.register(plain);
    session.register(verbatimTarget);
    session.focus("plain");
    await session.start();
    host.emit({ type: "final", text: "hello", latencyMs: 5 });
    session.focus("phrase");
    host.emit({ type: "final", text: "hello", latencyMs: 5 });
    expect(seen).toEqual([{ verbatim: false }, { verbatim: true }]);
    await session.stop();
  });

  it("hands queued lines to a dialog field registered after the command ran", async () => {
    vi.useFakeTimers();
    try {
      const runCommand = vi.fn(
        (_id: CommandId): Promise<CommandRunOutcome> => new Promise(() => {})
      );
      const session = createDictationSession({
        host,
        modelFor: (l) => models[l] ?? null,
        route: createRouter((text): RouteResult | null =>
          text === "new book"
            ? { kind: "voice_command", id: "bookList.newBook", polarity: null }
            : null
        ),
        runCommand: (...args) => runCommand(...args),
        isEditorCommand: () => false,
        isNavigatingCommand: (id) => id === "bookList.newBook",
        notify: (n) => void notices.push(n),
        copyText: (t) => copyText(t),
        stats: createLineStats(),
      });
      const oldTarget = fakeTarget("old");
      session.register(oldTarget);
      session.focus("old");
      await session.start();
      host.emit({ type: "final", text: "new book", latencyMs: 5 });
      expect(runCommand).toHaveBeenCalledWith("bookList.newBook");
      // A line spoken before the dialog field takes focus queues.
      host.emit({ type: "final", text: "my title", latencyMs: 5 });
      // The dialog field registers and takes the caret after the command ran.
      const field = fakeTarget("field");
      session.register(field);
      session.focus("field");
      expect(field.commits).toEqual(["my title"]);
      expect(oldTarget.commits).toEqual([]);
      expect(copied).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Dictation Session recordPhrase() (Phrase Recording, #270)", () => {
  const editsRoute = (text: string): RouteResult => ({
    kind: "edits",
    edits: [{ kind: "text", text }],
  });

  /** A session like makeSession() but with spies on route and runCommand. */
  function spySession() {
    const routeSpy = vi.fn(editsRoute);
    const runCommandSpy = vi.fn(async (_id: CommandId): Promise<CommandRunOutcome> => "ran");
    const session = createDictationSession({
      host,
      modelFor: (lang) => models[lang] ?? null,
      route: routeSpy,
      runCommand: (...args) => runCommandSpy(...args),
      isEditorCommand: () => false,
      notify: (n) => void notices.push(n),
      copyText: (t) => copyText(t),
      stats: createLineStats(),
      isEnabled: () => enabled,
    });
    return { session, routeSpy, runCommandSpy };
  }

  async function startListening(
    session: ReturnType<typeof makeSession>,
    target: DictationTarget & { commits?: string[] }
  ) {
    session.register(target);
    session.focus(target.id);
    await session.start();
    expect(session.getSnapshot().status).toBe("listening");
  }

  async function waitForRecording(session: ReturnType<typeof makeSession>) {
    await vi.waitFor(() =>
      expect(session.getSnapshot()).toMatchObject({ recording: true, status: "listening" })
    );
  }

  it("a. records one line with no Session running and ends idle and silent", async () => {
    const { session, routeSpy } = spySession();
    const recording = session.recordPhrase("es");
    await waitForRecording(session);
    expect(host.loads).toEqual(["m-es"]);
    host.emit({ type: "final", text: "Press tab.", latencyMs: 5 });
    await expect(recording).resolves.toEqual({ kind: "heard", text: "press tab" });
    await vi.waitFor(() =>
      expect(session.getSnapshot()).toMatchObject({ status: "idle", recording: false })
    );
    expect(host.stop).toHaveBeenCalled();
    expect(notices.filter((n) => n.kind === "started" || n.kind === "stopped")).toEqual([]);
    expect(routeSpy).not.toHaveBeenCalled();
  });

  it("b. pauses a listening Session, records in the phrase language, and resumes silently", async () => {
    const { session, routeSpy } = spySession();
    const applySpy = vi.fn(() => {});
    const target = { ...fakeTarget("chapter", "en"), apply: applySpy };
    await startListening(session, target);
    notices.length = 0;
    const recording = session.recordPhrase("es");
    await waitForRecording(session);
    // The pause stops the host before the recording loads its own model, and
    // the line it flushes is the author's own dictation: it lands in the target.
    await vi.waitFor(() => expect(host.loads).toEqual(["m-en", "m-es"]));
    expect(routeSpy).toHaveBeenCalledTimes(1);
    expect(routeSpy).toHaveBeenCalledWith("flushed", "", { verbatim: false });
    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(applySpy).toHaveBeenCalledWith([{ kind: "text", text: "flushed" }]);
    expect(session.getSnapshot()).toMatchObject({ language: "es" });
    host.emit({ type: "final", text: "Press tab.", latencyMs: 5 });
    await expect(recording).resolves.toEqual({ kind: "heard", text: "press tab" });
    await vi.waitFor(() =>
      expect(session.getSnapshot()).toMatchObject({
        status: "listening",
        language: "en",
        recording: false,
      })
    );
    expect(host.loads).toEqual(["m-en", "m-es", "m-en"]);
    expect(host.starts).toBe(3);
    expect(notices.filter((n) => n.kind === "started" || n.kind === "stopped")).toEqual([]);
    // Neither the recorded line nor the flush the recording's host emits on
    // stop ever routes or applies: only the pause flush did.
    expect(routeSpy).toHaveBeenCalledTimes(1);
    expect(applySpy).toHaveBeenCalledTimes(1);
  });

  it("c. never consults the route or runs a Voice Command for the recorded line", async () => {
    const { session, routeSpy, runCommandSpy } = spySession();
    const voice = vi.fn(() => "ran" as const);
    const target = { ...fakeTarget("chapter", "es"), voice };
    session.register(target);
    session.focus(target.id);
    const recording = session.recordPhrase("es");
    await waitForRecording(session);
    host.emit({ type: "final", text: "deshacer eso", latencyMs: 5 });
    await expect(recording).resolves.toEqual({ kind: "heard", text: "deshacer eso" });
    expect(routeSpy).not.toHaveBeenCalled();
    expect(runCommandSpy).not.toHaveBeenCalled();
    expect(voice).not.toHaveBeenCalled();
  });

  it("d. refuses a language with no model before pausing the listening Session", async () => {
    const session = makeSession();
    await startListening(session, fakeTarget("chapter", "en"));
    models.es = null;
    const stops = host.stop.mock.calls.length;
    await expect(session.recordPhrase("es")).resolves.toEqual({
      kind: "error",
      code: "model_missing",
      language: "es",
    });
    expect(host.stop.mock.calls.length).toBe(stops);
    expect(session.getSnapshot()).toMatchObject({ status: "listening", recording: false });
  });

  it("e. cancelRecording() ends the recording and the listening Session resumes", async () => {
    const session = makeSession();
    await startListening(session, fakeTarget("chapter", "en"));
    const recording = session.recordPhrase("es");
    await waitForRecording(session);
    await session.cancelRecording();
    await expect(recording).resolves.toEqual({ kind: "cancelled" });
    await vi.waitFor(() =>
      expect(session.getSnapshot()).toMatchObject({
        status: "listening",
        language: "en",
        recording: false,
      })
    );
  });

  it("f. stop() during a recording ends both without resuming", async () => {
    const session = makeSession();
    await startListening(session, fakeTarget("chapter", "en"));
    const recording = session.recordPhrase("es");
    await waitForRecording(session);
    await session.stop();
    await expect(recording).resolves.toEqual({ kind: "cancelled" });
    expect(session.getSnapshot()).toMatchObject({ status: "idle", recording: false });
    expect(notices.filter((n) => n.kind === "stopped")).toHaveLength(1);
  });

  it("g. ignores a final with no words and takes the next one", async () => {
    const session = makeSession();
    const recording = session.recordPhrase("en");
    await waitForRecording(session);
    host.emit({ type: "final", text: ".", latencyMs: 5 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(session.getSnapshot().recording).toBe(true);
    host.emit({ type: "final", text: "hola", latencyMs: 5 });
    await expect(recording).resolves.toEqual({ kind: "heard", text: "hola" });
  });

  it("h. reports a microphone denial as an error", async () => {
    host.start.mockRejectedValueOnce(new DictationError("mic_denied"));
    const session = makeSession();
    await expect(session.recordPhrase("es")).resolves.toEqual({
      kind: "error",
      code: "mic_denied",
    });
    expect(session.getSnapshot().recording).toBe(false);
  });

  it("i. refuses a second recording while one runs, without disturbing the first", async () => {
    const session = makeSession();
    const first = session.recordPhrase("es");
    await waitForRecording(session);
    await expect(session.recordPhrase("es")).resolves.toEqual({
      kind: "busy",
    });
    expect(host.loads).toEqual(["m-es"]);
    host.emit({ type: "final", text: "Press tab.", latencyMs: 5 });
    await expect(first).resolves.toEqual({ kind: "heard", text: "press tab" });
  });

  it("j. cancelling while the model loads never opens the microphone", async () => {
    host.holdLoad = true;
    const session = makeSession();
    const recording = session.recordPhrase("es");
    await vi.waitFor(() => expect(host.load).toHaveBeenCalled());
    const cancelling = session.cancelRecording();
    host.holdLoad = false;
    host.finishLoad();
    await cancelling;
    await expect(recording).resolves.toEqual({ kind: "cancelled" });
    expect(host.start).not.toHaveBeenCalled();
  });

  it("k. unregistering the last target keeps the heard line but the Session stays stopped", async () => {
    const session = makeSession();
    const unregister = session.register(fakeTarget("chapter", "en"));
    session.focus("chapter");
    await session.start();
    const recording = session.recordPhrase("es");
    await waitForRecording(session);
    unregister();
    host.emit({ type: "final", text: "hola", latencyMs: 5 });
    await expect(recording).resolves.toEqual({ kind: "heard", text: "hola" });
    await vi.waitFor(() =>
      expect(session.getSnapshot()).toMatchObject({ status: "idle", recording: false })
    );
    expect(notices.filter((n) => n.kind === "stopped")).toHaveLength(1);
  });

  it("l. refuses while Dictation is off without touching the host", async () => {
    enabled = false;
    const session = makeSession();
    await expect(session.recordPhrase("es")).resolves.toEqual({
      kind: "error",
      code: "unsupported",
    });
    expect(host.load).not.toHaveBeenCalled();
    expect(host.start).not.toHaveBeenCalled();
  });

  it("m. a second recording while the first is still pausing is busy at once", async () => {
    const session = makeSession();
    await startListening(session, fakeTarget("chapter", "en"));
    expect(host.loads).toEqual(["m-en"]);
    let releaseStop!: () => void;
    host.stop.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseStop = resolve))
    );
    const first = session.recordPhrase("es");
    await vi.waitFor(() => expect(host.stop).toHaveBeenCalledTimes(1));
    await expect(session.recordPhrase("en")).resolves.toEqual({ kind: "busy" });
    expect(host.loads).toEqual(["m-en"]);
    releaseStop();
    await waitForRecording(session);
    expect(host.loads).toEqual(["m-en", "m-es"]);
    host.emit({ type: "final", text: "Press tab.", latencyMs: 5 });
    await expect(first).resolves.toEqual({ kind: "heard", text: "press tab" });
    await vi.waitFor(() =>
      expect(session.getSnapshot()).toMatchObject({
        status: "listening",
        language: "en",
        recording: false,
      })
    );
    expect(host.loads.filter((id) => id === "m-es")).toHaveLength(1);
  });

  it("n. stop() during the pause ends the recording idle with one stopped notice", async () => {
    const session = makeSession();
    await startListening(session, fakeTarget("chapter", "en"));
    notices.length = 0;
    const startsBefore = host.starts;
    let releaseStop!: () => void;
    host.stop.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseStop = resolve))
    );
    const recording = session.recordPhrase("es");
    await vi.waitFor(() => expect(host.stop).toHaveBeenCalledTimes(1));
    const stopping = session.stop();
    releaseStop();
    await expect(recording).resolves.toEqual({ kind: "cancelled" });
    await stopping;
    await vi.waitFor(() =>
      expect(session.getSnapshot()).toMatchObject({ status: "idle", recording: false })
    );
    expect(notices.filter((n) => n.kind === "stopped")).toHaveLength(1);
    if (host.starts !== startsBefore) {
      const startOrder = host.start.mock.invocationCallOrder;
      const stopOrder = host.stop.mock.invocationCallOrder;
      expect(stopOrder[stopOrder.length - 1]).toBeGreaterThan(
        startOrder[startOrder.length - 1]
      );
    } else {
      expect(host.starts).toBe(startsBefore);
    }
  });

  it("o. cancelRecording() during the pause resumes the old Session silently", async () => {
    const session = makeSession();
    await startListening(session, fakeTarget("chapter", "en"));
    notices.length = 0;
    let releaseStop!: () => void;
    host.stop.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseStop = resolve))
    );
    const recording = session.recordPhrase("es");
    await vi.waitFor(() => expect(host.stop).toHaveBeenCalledTimes(1));
    const cancelling = session.cancelRecording();
    releaseStop();
    await expect(recording).resolves.toEqual({ kind: "cancelled" });
    await cancelling;
    await vi.waitFor(() =>
      expect(session.getSnapshot()).toMatchObject({
        status: "listening",
        language: "en",
        recording: false,
      })
    );
    expect(notices.filter((n) => n.kind === "started" || n.kind === "stopped")).toEqual(
      []
    );
  });

  it("p. recordPhrase uses its own language despite the Session override", async () => {
    const session = makeSession();
    const target = fakeTarget("chapter", "es");
    session.register(target);
    session.focus(target.id);
    await session.start();
    expect(session.getSnapshot()).toMatchObject({ language: "es" });
    await session.setLanguage("en");
    expect(session.getSnapshot()).toMatchObject({ language: "en" });
    const loadsBefore = [...host.loads];
    expect(loadsBefore).toEqual(["m-es", "m-en"]);
    const recording = session.recordPhrase("es");
    await waitForRecording(session);
    expect(host.loads[loadsBefore.length]).toBe("m-es");
    host.emit({ type: "final", text: "hola", latencyMs: 5 });
    await expect(recording).resolves.toEqual({ kind: "heard", text: "hola" });
    await vi.waitFor(() =>
      expect(session.getSnapshot()).toMatchObject({
        status: "listening",
        language: "en",
        recording: false,
      })
    );
  });

  it("q. cancelRecording() while the microphone is opening releases it", async () => {
    const session = makeSession();
    let releaseStart!: () => void;
    host.start.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseStart = resolve))
    );
    const recording = session.recordPhrase("es");
    await vi.waitFor(() => expect(host.start).toHaveBeenCalledTimes(1));
    const cancelling = session.cancelRecording();
    releaseStart();
    await expect(recording).resolves.toEqual({ kind: "cancelled" });
    await cancelling;
    expect(host.stop).toHaveBeenCalled();
    await vi.waitFor(() => expect(session.getSnapshot().recording).toBe(false));
    expect(["idle", "listening"]).toContain(session.getSnapshot().status);
  });

  it("r. recordPhrase waits for a start in flight, then pauses and resumes", async () => {
    host.holdLoad = true;
    const session = makeSession();
    const target = fakeTarget("chapter", "en");
    session.register(target);
    session.focus(target.id);
    const starting = session.start();
    expect(session.getSnapshot().status).toBe("loading");
    const recording = session.recordPhrase("es");
    host.holdLoad = false;
    host.finishLoad();
    await starting;
    await waitForRecording(session);
    host.emit({ type: "final", text: "Press tab.", latencyMs: 5 });
    await expect(recording).resolves.toEqual({ kind: "heard", text: "press tab" });
    await vi.waitFor(() =>
      expect(session.getSnapshot()).toMatchObject({
        status: "listening",
        language: "en",
        recording: false,
      })
    );
  });

  it("s. Dictation off mid-recording ends cancelled with no resume", async () => {
    const session = makeSession();
    await startListening(session, fakeTarget("chapter", "en"));
    const recording = session.recordPhrase("es");
    await waitForRecording(session);
    enabled = false;
    await session.stop();
    await expect(recording).resolves.toEqual({ kind: "cancelled" });
    await vi.waitFor(() =>
      expect(session.getSnapshot()).toMatchObject({ status: "idle", recording: false })
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(session.getSnapshot().status).toBe("idle");
    expect(host.loads).toEqual(["m-en", "m-es"]);
  });
});
