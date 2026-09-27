import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDictationSession,
  type DictationTarget,
  type SessionNotice,
} from "@/features/dictation/session";
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
    commit: (text) => void target.commits.push(text),
  };
  return target;
}

let host: ReturnType<typeof fakeHost>;
let notices: SessionNotice[];
let copied: string[];
let models: Record<string, ModelSpec | null>;

function makeSession() {
  return createDictationSession({
    host,
    modelFor: (lang) => models[lang] ?? null,
    route: createRouter(),
    runCommand: vi.fn(),
    notify: (n) => void notices.push(n),
    copyText: async (t) => void copied.push(t),
    stats: createLineStats(),
  });
}

beforeEach(() => {
  host = fakeHost();
  notices = [];
  copied = [];
  models = { es: model("es"), en: model("en") };
});

describe("Dictation Session", () => {
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
    expect(notices).toEqual([
      { kind: "error", code: "model_missing", language: "es" },
    ]);
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

  it("routes a command result to runCommand instead of the editor", async () => {
    const runCommand = vi.fn();
    const target = fakeTarget("a");
    const session = createDictationSession({
      host,
      modelFor: (l) => models[l] ?? null,
      route: createRouter(() => ({ kind: "command", id: "common.save" })),
      runCommand,
      notify: () => {},
      copyText: async () => {},
      stats: createLineStats(),
    });
    session.register(target);
    session.focus("a");
    await session.start();
    host.emit({ type: "final", text: "guardar" });
    expect(runCommand).toHaveBeenCalledWith("common.save");
    expect(target.commits).toEqual([]);
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
});
