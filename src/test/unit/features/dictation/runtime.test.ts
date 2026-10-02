import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUnsupportedHost, unsupportedModelFiles } from "@/lib/platform/unsupported-dictation";
import { useTutorialStore } from "@/features/tutorial/store";
import {
  DictationError,
  type DictationEvent,
  type DictationLanguage,
  type ModelFiles,
  type ModelSpec,
  type ModelTier,
} from "@/features/dictation/types";

const { createRecognizerHost, getModelFiles } = vi.hoisted(() => ({
  createRecognizerHost: vi.fn(),
  getModelFiles: vi.fn(),
}));
vi.mock("@/lib/platform", () => ({
  dictationPlatform: () => "web",
  createRecognizerHost,
  getModelFiles,
}));

const { getDictation, resetDictationForTests } = await import("@/features/dictation/runtime");
const { useDictationStore } = await import("@/features/dictation/store");
const { MODEL_CATALOG } = await import("@/features/dictation/catalog");
const { useShortcutSettingsStore } = await import("@/features/settings/shortcut-store");
const { DEFAULT_SHORTCUT_SETTINGS } = await import("@/lib/shortcut-resolve");
const librarySwitch = await import("@/features/tutorial/library-switch");

function catalogModel(language: DictationLanguage, tier: ModelTier): ModelSpec {
  const spec = MODEL_CATALOG.find(
    (candidate) => candidate.languages[0] === language && candidate.tier === tier
  );
  if (!spec) throw new Error(`no ${tier} ${language} model in the catalog`);
  return spec;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** Model files that mark a spec complete once it installs; `hold` defers one spec's install. */
function fakeModelFiles() {
  const complete = new Set<string>();
  const held = new Map<string, Promise<void>>();
  const files: ModelFiles = {
    install: async (spec, _onProgress, signal) => {
      const gate = held.get(spec.id);
      if (gate) {
        await Promise.race([
          gate,
          new Promise((_settle, reject) =>
            signal.addEventListener("abort", () => reject(new Error("aborted")))
          ),
        ]);
      }
      complete.add(spec.id);
    },
    isComplete: async (spec) => complete.has(spec.id),
    remove: async (id) => {
      complete.delete(id);
    },
  };
  return {
    files,
    /** Defers `id`'s install until the returned gate is resolved. */
    hold: (id: string) => {
      const gate = deferred();
      held.set(id, gate.promise);
      return gate;
    },
  };
}

/** A host that loads and listens, so a Session can reach its picked model. */
function listeningHost() {
  return {
    ...createUnsupportedHost("platform"),
    load: vi.fn(async () => {}),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  resetDictationForTests();
  librarySwitch.resetLibrarySwitchForTests();
  useDictationStore.setState({
    enabled: true,
    installed: [],
    downloads: {},
    preferredTier: { en: "fast", es: "fast" },
  });
  useTutorialStore.setState({ status: "idle" });
  useShortcutSettingsStore.setState({ shortcuts: structuredClone(DEFAULT_SHORTCUT_SETTINGS) });
  createRecognizerHost.mockReset();
  getModelFiles.mockReset();
  getModelFiles.mockResolvedValue(unsupportedModelFiles);
});

describe("getDictation()", () => {
  it("turning Dictation off releases an active microphone and keeps models", async () => {
    const host = {
      ...createUnsupportedHost("platform"),
      load: vi.fn(async () => {}),
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
    };
    createRecognizerHost.mockResolvedValue(host);
    const { session } = await getDictation();
    useDictationStore.setState({ installed: [MODEL_CATALOG[0].id] });
    session.register({
      id: "chapter",
      language: () => "en",
      showPartial() {},
      before: () => "",
      apply() {},
    });
    session.focus("chapter");
    await session.start();
    expect(session.getSnapshot().status).toBe("listening");
    useDictationStore.getState().setEnabled(false);
    await vi.waitFor(() => expect(host.stop).toHaveBeenCalledTimes(1));
    expect(session.getSnapshot().status).toBe("idle");
    expect(useDictationStore.getState().installed).toEqual([MODEL_CATALOG[0].id]);
    useDictationStore.getState().setEnabled(true);
    await session.start();
    expect(host.start).toHaveBeenCalledTimes(2);
    await session.stop();
  });
  it("refuses to load a model or open the microphone while Dictation is off", async () => {
    const host = {
      ...createUnsupportedHost("platform"),
      load: vi.fn(async () => {}),
      start: vi.fn(async () => {}),
    };
    createRecognizerHost.mockResolvedValue(host);
    const { session } = await getDictation();
    useDictationStore.setState({ installed: [MODEL_CATALOG[0].id], enabled: false });
    session.register({
      id: "chapter",
      language: () => "en",
      showPartial() {},
      before: () => "",
      apply() {},
    });
    session.focus("chapter");
    await session.start();
    await session.toggle();
    expect(host.load).not.toHaveBeenCalled();
    expect(host.start).not.toHaveBeenCalled();
    expect(session.getSnapshot().status).toBe("idle");
  });
  it("blocks Voice Commands while a Tutorial run is under way", async () => {
    const control: { listener: ((event: DictationEvent) => void) | null } = { listener: null };
    const host = {
      ...createUnsupportedHost("platform"),
      load: vi.fn(async () => {}),
      start: vi.fn(async (listener: (event: DictationEvent) => void) => {
        control.listener = listener;
      }),
      stop: vi.fn(async () => {}),
    };
    createRecognizerHost.mockResolvedValue(host);
    const { session } = await getDictation();
    const esFast = MODEL_CATALOG.find((m) => m.languages[0] === "es" && m.tier === "fast");
    if (!esFast) throw new Error("no Spanish model in the catalog");
    useDictationStore.setState({ installed: [esFast.id] });
    const voice = vi.fn(() => "ran" as const);
    session.register({
      id: "chapter",
      language: () => "es",
      showPartial() {},
      before: () => "",
      apply() {},
      voice,
    });
    session.focus("chapter");
    await session.start();

    useTutorialStore.setState({ status: "running" });
    control.listener?.({ type: "final", text: "poner negrita" });
    expect(voice).not.toHaveBeenCalled();

    useTutorialStore.setState({ status: "idle" });
    control.listener?.({ type: "final", text: "poner negrita" });
    expect(voice).toHaveBeenCalledWith({ id: "editor.bold", polarity: "on" });
    await session.stop();
  });

  it("keeps the all-caps lock across lines until the session ends (#271)", async () => {
    const control: { listener: ((event: DictationEvent) => void) | null } = { listener: null };
    const host = {
      ...createUnsupportedHost("platform"),
      load: vi.fn(async () => {}),
      start: vi.fn(async (listener: (event: DictationEvent) => void) => {
        control.listener = listener;
      }),
      stop: vi.fn(async () => {}),
    };
    createRecognizerHost.mockResolvedValue(host);
    const { session } = await getDictation();
    const enFast = MODEL_CATALOG.find((m) => m.languages[0] === "en" && m.tier === "fast");
    if (!enFast) throw new Error("no English model in the catalog");
    useDictationStore.setState({ installed: [enFast.id] });
    const applied: string[] = [];
    session.register({
      id: "chapter",
      language: () => "en",
      showPartial() {},
      before: () => "",
      apply: (edits) =>
        void applied.push(edits.map((edit) => (edit.kind === "text" ? edit.text : "\n")).join("")),
    });
    session.focus("chapter");
    await session.start();

    control.listener?.({ type: "final", text: "all caps on hello", latencyMs: 5 });
    expect(applied).toEqual(["HELLO"]);

    await session.stop();
    await session.start();
    control.listener?.({ type: "final", text: "world", latencyMs: 5 });
    expect(applied).toEqual(["HELLO", "World"]);
    await session.stop();
  });

  it("hears the author's custom Voice Commands as soon as they change", async () => {
    const control: { listener: ((event: DictationEvent) => void) | null } = { listener: null };
    const host = {
      ...createUnsupportedHost("platform"),
      load: vi.fn(async () => {}),
      start: vi.fn(async (listener: (event: DictationEvent) => void) => {
        control.listener = listener;
      }),
      stop: vi.fn(async () => {}),
    };
    createRecognizerHost.mockResolvedValue(host);
    const { session } = await getDictation();
    const esFast = MODEL_CATALOG.find((m) => m.languages[0] === "es" && m.tier === "fast");
    if (!esFast) throw new Error("no Spanish model in the catalog");
    useDictationStore.setState({ installed: [esFast.id] });
    const voice = vi.fn(() => "ran" as const);
    const apply = vi.fn();
    session.register({
      id: "chapter",
      language: () => "es",
      showPartial() {},
      before: () => "",
      apply,
      voice,
    });
    session.focus("chapter");
    await session.start();

    useShortcutSettingsStore
      .getState()
      .setCommandVoicePhrases("editor.bold", "es", ["pon esto fuerte"]);
    control.listener?.({ type: "final", text: "Pon esto fuerte." });
    expect(voice).toHaveBeenCalledWith({ id: "editor.bold", polarity: "on" });

    // The author's list replaced the defaults: the old phrase is text now.
    voice.mockClear();
    control.listener?.({ type: "final", text: "poner negrita" });
    expect(voice).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalled();

    useShortcutSettingsStore.getState().resetCommandVoicePhrases("editor.bold", "es");
    control.listener?.({ type: "final", text: "poner negrita" });
    expect(voice).toHaveBeenCalledWith({ id: "editor.bold", polarity: "on" });
    await session.stop();
  });

  it("builds the runtime once and shares it", async () => {
    createRecognizerHost.mockResolvedValue(createUnsupportedHost("platform"));
    const [a, b] = await Promise.all([getDictation(), getDictation()]);
    expect(a).toBe(b);
    expect(createRecognizerHost).toHaveBeenCalledTimes(1);
  });

  it("a failed build is not cached, so the next call retries", async () => {
    createRecognizerHost
      .mockRejectedValueOnce(new Error("worker failed to load"))
      .mockResolvedValue(createUnsupportedHost("platform"));
    await expect(getDictation()).rejects.toThrow("worker failed to load");
    await expect(getDictation()).resolves.toBeDefined();
    expect(createRecognizerHost).toHaveBeenCalledTimes(2);
  });

  it("asking for a missing language leaves the selected model's interpreter in place", async () => {
    const control: { listener: ((event: DictationEvent) => void) | null } = { listener: null };
    const host = {
      ...createUnsupportedHost("platform"),
      load: vi.fn(async () => {}),
      start: vi.fn(async (listener: (event: DictationEvent) => void) => {
        control.listener = listener;
      }),
      stop: vi.fn(async () => {}),
    };
    createRecognizerHost.mockResolvedValue(host);
    const { session } = await getDictation();
    const enFast = MODEL_CATALOG.find((m) => m.languages[0] === "en" && m.tier === "fast");
    if (!enFast) throw new Error("no English model in the catalog");
    useDictationStore.setState({ installed: [enFast.id] });
    const applied: string[] = [];
    session.register({
      id: "chapter",
      language: () => "en",
      showPartial() {},
      before: () => "",
      apply: (edits) =>
        void applied.push(edits.map((edit) => (edit.kind === "text" ? edit.text : "\n")).join("")),
    });
    session.focus("chapter");
    await session.start();

    control.listener?.({ type: "final", text: "all caps on hello", latencyMs: 5 });
    expect(applied).toEqual(["HELLO"]);

    // Spanish has no installed model: the recording is refused before anything pauses.
    await expect(session.recordPhrase("es")).resolves.toEqual({
      kind: "error",
      code: "model_missing",
      language: "es",
    });

    // The next line still runs through the selected English model's
    // interpreter (caps lock on): raw text would have kept its casing.
    control.listener?.({ type: "final", text: "world", latencyMs: 5 });
    expect(applied).toEqual(["HELLO", "WORLD"]);
    await session.stop();
  });

  it("notifies and rethrows when a model install fails", async () => {
    createRecognizerHost.mockResolvedValue(createUnsupportedHost("platform"));
    getModelFiles.mockResolvedValue({
      install: async () => {
        throw new DictationError("download_failed");
      },
      isComplete: async () => false,
      remove: async () => {},
    } satisfies ModelFiles);
    const runtime = await getDictation();
    const notify = vi.fn();
    runtime.setNotifier(notify);
    const spec = {
      id: "spec",
      engine: "moonshine",
      languages: ["en"],
      tier: "fast",
      platforms: ["web"],
      files: [],
      engineOptions: {},
      capabilities: { casing: true, punctuation: true, streaming: true },
    } satisfies ModelSpec;

    await expect(runtime.install(spec)).rejects.toThrow("download_failed");
    expect(notify).toHaveBeenCalledWith({
      kind: "error",
      code: "download_failed",
    });
  });
});

describe("install()", () => {
  it("makes the first model downloaded for a language that language's preference", async () => {
    createRecognizerHost.mockResolvedValue(listeningHost());
    getModelFiles.mockResolvedValue(fakeModelFiles().files);
    const runtime = await getDictation();
    const accurate = catalogModel("en", "accurate");

    await runtime.install(accurate);

    const state = useDictationStore.getState();
    expect(state.installed).toEqual([accurate.id]);
    expect(state.preferredTier).toEqual({ en: "accurate", es: "fast" });
    expect(state.downloads).toEqual({});

    // The Session runs on the model the automatic selection picked.
    runtime.session.register({
      id: "chapter",
      language: () => "en",
      showPartial() {},
      before: () => "",
      apply() {},
    });
    runtime.session.focus("chapter");
    await runtime.session.start();
    expect(runtime.session.getSnapshot().modelId).toBe(accurate.id);
    await runtime.session.stop();
  });

  it("selects each Dictation Language on its own first download", async () => {
    createRecognizerHost.mockResolvedValue(createUnsupportedHost("platform"));
    getModelFiles.mockResolvedValue(fakeModelFiles().files);
    const runtime = await getDictation();

    await runtime.install(catalogModel("es", "accurate"));

    expect(useDictationStore.getState().preferredTier).toEqual({ en: "fast", es: "accurate" });
  });

  it("keeps the first selection when a second model of that language lands", async () => {
    createRecognizerHost.mockResolvedValue(listeningHost());
    getModelFiles.mockResolvedValue(fakeModelFiles().files);
    const runtime = await getDictation();
    const accurate = catalogModel("en", "accurate");
    const fast = catalogModel("en", "fast");

    await runtime.install(accurate);
    await runtime.install(fast);

    const state = useDictationStore.getState();
    expect(state.preferredTier.en).toBe("accurate");
    expect(state.installed).toHaveLength(2);
    expect(state.installed).toContain(accurate.id);
    expect(state.installed).toContain(fast.id);

    // Two models of one language are installed: the preference is what picks.
    runtime.session.register({
      id: "chapter",
      language: () => "en",
      showPartial() {},
      before: () => "",
      apply() {},
    });
    runtime.session.focus("chapter");
    await runtime.session.start();
    expect(runtime.session.getSnapshot().modelId).toBe(accurate.id);
    await runtime.session.stop();
  });

  it("keeps the author's tier while a second model of that language downloads", async () => {
    createRecognizerHost.mockResolvedValue(createUnsupportedHost("platform"));
    const { files, hold } = fakeModelFiles();
    getModelFiles.mockResolvedValue(files);
    const runtime = await getDictation();
    const fast = catalogModel("en", "fast");
    const accurate = catalogModel("en", "accurate");

    await runtime.install(fast);
    const gate = hold(accurate.id);
    const installing = runtime.install(accurate);
    // The author answers Fast again while Accurate is still downloading.
    useDictationStore.getState().setPreferredTier("en", "fast");
    gate.resolve();
    await installing;

    const state = useDictationStore.getState();
    expect(state.preferredTier).toEqual({ en: "fast", es: "fast" });
    expect(state.installed).toContain(accurate.id);
  });

  it("gives overlapping downloads of one language to the first that completes", async () => {
    createRecognizerHost.mockResolvedValue(createUnsupportedHost("platform"));
    const { files, hold } = fakeModelFiles();
    getModelFiles.mockResolvedValue(files);
    const runtime = await getDictation();
    const accurate = catalogModel("en", "accurate");
    const fast = catalogModel("en", "fast");
    // Holds the read-back every download finishes with, so the second
    // completion lands while the first install's refresh is still pending.
    const readGate = deferred();
    const isComplete = files.isComplete;
    files.isComplete = async (spec) => {
      await readGate.promise;
      return isComplete(spec);
    };
    const accurateGate = hold(accurate.id);
    const fastGate = hold(fast.id);

    const accurateInstall = runtime.install(accurate);
    const fastInstall = runtime.install(fast);
    accurateGate.resolve();
    await vi.waitFor(() => expect(useDictationStore.getState().preferredTier.en).toBe("accurate"));

    fastGate.resolve();
    await vi.waitFor(() => expect(useDictationStore.getState().downloads).toEqual({}));

    // Both downloads are read while neither refresh has run: the first
    // completion's selection is what the second one sees.
    const state = useDictationStore.getState();
    expect(state.preferredTier.en).toBe("accurate");
    expect(state.installed).toContain(accurate.id);
    expect(state.installed).toContain(fast.id);
    readGate.resolve();
    await Promise.all([accurateInstall, fastInstall]);
  });

  it("persists the automatic selection with the device's Dictation record", async () => {
    createRecognizerHost.mockResolvedValue(createUnsupportedHost("platform"));
    getModelFiles.mockResolvedValue(fakeModelFiles().files);
    const runtime = await getDictation();

    await runtime.install(catalogModel("en", "accurate"));

    const saved = JSON.parse(localStorage.getItem("maibuk-dictation") ?? "{}") as {
      state?: { preferredTier?: unknown };
    };
    expect(saved.state?.preferredTier).toEqual({ en: "accurate", es: "fast" });
  });

  it("leaves every preference alone when a download fails", async () => {
    createRecognizerHost.mockResolvedValue(createUnsupportedHost("platform"));
    getModelFiles.mockResolvedValue({
      install: async () => {
        throw new DictationError("download_failed");
      },
      isComplete: async () => false,
      remove: async () => {},
    } satisfies ModelFiles);
    const runtime = await getDictation();

    await expect(runtime.install(catalogModel("en", "accurate"))).rejects.toThrow(
      "download_failed"
    );

    const state = useDictationStore.getState();
    expect(state.installed).toEqual([]);
    expect(state.preferredTier).toEqual({ en: "fast", es: "fast" });
    expect(state.downloads).toEqual({});
  });

  it("leaves every preference alone when a download is cancelled", async () => {
    createRecognizerHost.mockResolvedValue(createUnsupportedHost("platform"));
    const { files, hold } = fakeModelFiles();
    getModelFiles.mockResolvedValue(files);
    const runtime = await getDictation();
    const accurate = catalogModel("en", "accurate");
    hold(accurate.id);

    const installing = runtime.install(accurate);
    runtime.cancelInstall(accurate.id);

    await expect(installing).rejects.toMatchObject({ code: "cancelled" });
    const state = useDictationStore.getState();
    expect(state.installed).toEqual([]);
    expect(state.preferredTier).toEqual({ en: "fast", es: "fast" });
    expect(state.downloads).toEqual({});
  });

  it("refuses a download while the Tutorial runs and changes no preference", async () => {
    createRecognizerHost.mockResolvedValue(createUnsupportedHost("platform"));
    const { files } = fakeModelFiles();
    getModelFiles.mockResolvedValue(files);
    const runtime = await getDictation();
    librarySwitch.activateTutorialDatabase({} as never);

    await expect(runtime.install(catalogModel("en", "accurate"))).rejects.toMatchObject({
      code: "tutorial_active",
    });

    const state = useDictationStore.getState();
    expect(state.installed).toEqual([]);
    expect(state.preferredTier).toEqual({ en: "fast", es: "fast" });
  });
});
