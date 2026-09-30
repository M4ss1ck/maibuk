import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDictationSession,
  type DictationTarget,
  type SessionNotice,
} from "@/features/dictation/session";
import type { CommandRunOutcome } from "@/lib/command-runner";
import type { CommandId } from "@/lib/shortcut-registry";
import { createRouter } from "@/features/dictation/router";
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
