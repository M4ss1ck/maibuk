// Wires the Dictation Session to this build's platform ports, once.
import { MODEL_CATALOG } from "@/features/dictation/catalog";
import {
  createModelStore,
  type ModelStore,
} from "@/features/dictation/model-store";
import { createRouter } from "@/features/dictation/router";
import { attachSession } from "@/features/dictation/hub";
import {
  createDictationSession,
  type DictationSession,
  type SessionNotice,
} from "@/features/dictation/session";
import { createLineStats, type LineStats } from "@/features/dictation/stats";
import { pickModel, useDictationStore } from "@/features/dictation/store";
import type { ModelSpec, RecognizerHost } from "@/features/dictation/types";
import { isTutorialLibraryActive } from "@/features/tutorial/library-switch";
import {
  createRecognizerHost,
  dictationPlatform,
  getModelFiles,
} from "@/lib/platform";
import {
  createUnsupportedHost,
  unsupportedModelFiles,
} from "@/lib/platform/unsupported-dictation";

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

export function getDictation(): Promise<DictationRuntime> {
  // A failed build (worker or native host failed to load) must not disable Dictation for the whole run.
  runtime ??= build().catch((error: unknown) => {
    runtime = null;
    throw error;
  });
  return runtime;
}

export function resetDictationForTests(): void {
  runtime = null;
}

async function build(): Promise<DictationRuntime> {
  const platform = dictationPlatform();
  const host = platform
    ? await createRecognizerHost()
    : createUnsupportedHost("platform");
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

  const session = createDictationSession({
    host,
    modelFor: (language) => {
      const { installed, preferredTier } = useDictationStore.getState();
      return pickModel(language, models.available(), installed, preferredTier);
    },
    route: createRouter(),
    // Voice Commands (Anticipated) dispatch registry Commands here; v1's router never asks.
    runCommand: () => {},
    notify: (notice) => notify(notice),
    copyText: (text) => navigator.clipboard.writeText(text),
    stats,
  });
  session.subscribe(() =>
    useDictationStore.setState({ snapshot: session.getSnapshot() }),
  );
  attachSession(session);

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
          spec.files.reduce((sum, f) => sum + f.bytes, 0),
        );
        await models.install(spec, progress, controller.signal);
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
