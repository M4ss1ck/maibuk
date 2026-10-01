// Wires the Dictation Session to this build's platform ports, once.
import { MODEL_CATALOG } from "@/features/dictation/catalog";
import { createModelStore, type ModelStore } from "@/features/dictation/model-store";
import { createRouter } from "@/features/dictation/router";
import {
  buildPhraseTable,
  interpret,
  INITIAL_INTERPRETER_STATE,
  type PhraseTable,
} from "@/features/dictation/interpreter";
import { catalogCapabilities } from "@/features/dictation/spoken-punctuation";
import { attachSession } from "@/features/dictation/hub";
import {
  createDictationSession,
  type DictationSession,
  type SessionNotice,
} from "@/features/dictation/session";
import { createLineStats, type LineStats } from "@/features/dictation/stats";
import { pickModel, useDictationStore } from "@/features/dictation/store";
import {
  toDictationError,
  type DictationLanguage,
  type ModelSpec,
  type RecognizerHost,
} from "@/features/dictation/types";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import { isTutorialLibraryActive } from "@/features/tutorial/library-switch";
import { isTutorialStatusActive, useTutorialStore } from "@/features/tutorial/store";
import { createRecognizerHost, dictationPlatform, getModelFiles } from "@/lib/platform";
import { clearChoices, hasChoices, pressByName, pressChoice } from "@/lib/click-by-name";
import { getCommand } from "@/lib/shortcut-registry";
import { runCommand } from "@/lib/command-runner";
import { createUnsupportedHost, unsupportedModelFiles } from "@/lib/platform/unsupported-dictation";

export interface DictationRuntime {
  session: DictationSession;
  host: RecognizerHost;
  models: ModelStore;
  stats: LineStats;
  refreshInstalled(): Promise<void>;
  install(spec: ModelSpec): Promise<void>;
  cancelInstall(id: string): void;
  remove(id: string): Promise<void>;
  setNotifier(notify: (notice: SessionNotice) => void): void;
}

let runtime: Promise<DictationRuntime> | null = null;
let unsubscribeEnabled: (() => void) | null = null;
let unsubscribeVoice: (() => void) | null = null;

export function getDictation(): Promise<DictationRuntime> {
  // A failed build (worker or native host failed to load) must not disable Dictation for the whole run.
  runtime ??= build().catch((error: unknown) => {
    runtime = null;
    throw error;
  });
  return runtime;
}

export function resetDictationForTests(): void {
  unsubscribeEnabled?.();
  unsubscribeEnabled = null;
  unsubscribeVoice?.();
  unsubscribeVoice = null;
  runtime = null;
}

async function build(): Promise<DictationRuntime> {
  const platform = dictationPlatform();
  const host = platform ? await createRecognizerHost() : createUnsupportedHost("platform");
  const files = platform ? await getModelFiles() : unsupportedModelFiles;
  const models = createModelStore({
    files,
    catalog: MODEL_CATALOG,
    platform: platform ?? "web",
    isTutorialActive: isTutorialLibraryActive,
  });
  const stats = createLineStats();
  const aborts = new Map<string, AbortController>();
  let notify: (notice: SessionNotice) => void = () => {};
  let selectedModel: ModelSpec | null = null;
  let selectedLanguage: DictationLanguage = "es";
  let interpreterState = INITIAL_INTERPRETER_STATE;
  // The author's switches, aliases, and Vocabulary feed the table; so do the
  // picked model's capabilities, which set the entries' defaults.
  const buildTable = (language: DictationLanguage): PhraseTable =>
    buildPhraseTable(language, {
      settings: useDictationStore.getState().spokenPunctuation[language],
      vocabulary: useDictationStore.getState().vocabulary[language],
      voice: useShortcutSettingsStore.getState().shortcuts.voice,
      capabilities:
        selectedLanguage === language && selectedModel
          ? selectedModel.capabilities
          : catalogCapabilities(language),
    });
  let phraseTables: Record<DictationLanguage, PhraseTable> = {
    en: buildTable("en"),
    es: buildTable("es"),
  };

  const session = createDictationSession({
    host,
    modelFor: (language) => {
      const { installed, preferredTier } = useDictationStore.getState();
      const picked = pickModel(language, models.available(), installed, preferredTier);
      // A Phrase Recording asks before it pauses anything: a language with no
      // model must leave the running Session's model and tables alone.
      if (!picked) return null;
      selectedLanguage = language;
      selectedModel = picked;
      // No state reset here: a stop resets it through its notice, and a
      // recording's pause is silent, so the all-caps lock outlives it.
      phraseTables = { ...phraseTables, [language]: buildTable(language) };
      return selectedModel;
    },
    route: createRouter((line, before, options) => {
      if (!selectedModel) return null;
      const output = interpret({
        line,
        before,
        capabilities: selectedModel.capabilities,
        table: phraseTables[selectedLanguage],
        state: interpreterState,
        verbatim: options?.verbatim === true,
      });
      interpreterState = output.state;
      if (output.result.kind === "scratch") return { kind: "scratch" };
      if (output.result.kind === "click") return { kind: "click", name: output.result.name };
      if (output.result.kind === "click_number")
        return { kind: "click_number", n: output.result.n };
      return {
        ...output.result,
        spokenPunctuationCount: output.spokenPunctuationCount,
        ...(output.capsLock !== undefined ? { capsLock: output.capsLock } : {}),
      };
    }),
    // Voice Commands run on the target's editor; the Tutorial blocks them
    // exactly like Shortcuts, so only its own skip works while a run is on.
    voiceCommandsAllowed: () => !isTutorialStatusActive(useTutorialStore.getState().status),
    // Commands outside the editor's keymap run through the Command Runner.
    runCommand: (id) => runCommand(id, { source: "voice" }),
    isEditorCommand: (id) => getCommand(id).source === "editor-keymap",
    // A Command whose dialog puts the caret in a text field opens the hand-off
    // window too, so lines spoken before the field takes focus land in it.
    isNavigatingCommand: (id) =>
      getCommand(id).navigates === true || getCommand(id).opensDialog === true,
    notify: (notice) => {
      if (notice.kind === "stopped") interpreterState = INITIAL_INTERPRETER_STATE;
      notify(notice);
    },
    copyText: (text) => navigator.clipboard.writeText(text),
    stats,
    isEnabled: () => useDictationStore.getState().enabled,
    click: { pressByName, pressChoice, clearChoices, hasChoices },
  });
  session.subscribe(() => useDictationStore.setState({ snapshot: session.getSnapshot() }));

  const refreshInstalled = async () => {
    useDictationStore.setState({
      installed: [...(await models.installedIds())],
    });
  };

  const support = platform
    ? await host.isSupported()
    : { supported: false, reason: "platform" as const };
  useDictationStore.setState({ support });
  if (support.supported) await refreshInstalled();

  // Turning Dictation off mid-session releases the microphone; a Spoken
  // Punctuation or Vocabulary change rebuilds the tables the next line is
  // matched against.
  unsubscribeEnabled = useDictationStore.subscribe((state, previous) => {
    if (!state.enabled && previous.enabled) void session.stop();
    if (
      state.spokenPunctuation !== previous.spokenPunctuation ||
      state.vocabulary !== previous.vocabulary
    ) {
      phraseTables = { en: buildTable("en"), es: buildTable("es") };
    }
  });
  // Custom Voice Commands live with the Custom Shortcuts (ADR 0012, ADR 0014).
  unsubscribeVoice = useShortcutSettingsStore.subscribe((state, previous) => {
    if (state.shortcuts.voice !== previous.shortcuts.voice) {
      phraseTables = { en: buildTable("en"), es: buildTable("es") };
    }
  });
  attachSession(session);

  return {
    session,
    host,
    models,
    stats,
    refreshInstalled,
    async install(spec) {
      const controller = new AbortController();
      aborts.set(spec.id, controller);
      const progress = (done: number, total: number) =>
        useDictationStore.setState((s) => ({
          downloads: { ...s.downloads, [spec.id]: { done, total } },
        }));
      try {
        progress(
          0,
          spec.files.reduce((sum, f) => sum + f.bytes, 0)
        );
        await models.install(spec, progress, controller.signal);
      } catch (error) {
        // The session notifies for engine errors; the download reports its own
        // failure the same way, then the caller still sees the rejection.
        notify({
          kind: "error",
          code: toDictationError(error, "download_failed").code,
        });
        throw error;
      } finally {
        aborts.delete(spec.id);
        useDictationStore.setState((s) => {
          const { [spec.id]: _done, ...rest } = s.downloads;
          return { downloads: rest };
        });
        await refreshInstalled();
      }
    },
    cancelInstall: (id) => aborts.get(id)?.abort(),
    async remove(id) {
      await models.remove(id);
      await refreshInstalled();
    },
    setNotifier: (fn) => {
      notify = fn;
    },
  };
}
