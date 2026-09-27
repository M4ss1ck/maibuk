import {
  DictationError,
  toDictationError,
  type DictationPlatform,
  type ModelFiles,
  type ModelSpec,
} from "@/features/dictation/types";

export interface ModelStore {
  available(): ModelSpec[];
  installedIds(): Promise<Set<string>>;
  install(
    spec: ModelSpec,
    onProgress: (done: number, total: number) => void,
    signal: AbortSignal
  ): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Engine-blind: installs whatever files a ModelSpec lists. */
export function createModelStore(deps: {
  files: ModelFiles;
  catalog: readonly ModelSpec[];
  platform: DictationPlatform;
  isTutorialActive: () => boolean;
}): ModelStore {
  const available = () => deps.catalog.filter((spec) => spec.platforms.includes(deps.platform));
  return {
    available,
    async installedIds() {
      const ids = new Set<string>();
      for (const spec of available()) {
        if (await deps.files.isComplete(spec)) ids.add(spec.id);
      }
      return ids;
    },
    async install(spec, onProgress, signal) {
      // A download is a background job: it never runs against the Tutorial Library (ADR 0008).
      if (deps.isTutorialActive()) throw new DictationError("tutorial_active");
      try {
        await deps.files.install(spec, onProgress, signal);
      } catch (error) {
        throw toDictationError(error, signal.aborted ? "cancelled" : "download_failed");
      }
    },
    remove: (id) => deps.files.remove(id),
  };
}
