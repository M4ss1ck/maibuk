export * from "@/features/dictation/types";
export { MODEL_CATALOG, modelsFor, validateCatalog } from "@/features/dictation/catalog";
export { createCrc32c, crc32cBase64, type Crc32c } from "@/features/dictation/crc32c";
export { createModelStore, type ModelStore } from "@/features/dictation/model-store";
export {
  createRouter,
  type DictationEdit,
  type Interpreter,
  type RouteResult,
} from "@/features/dictation/router";
export {
  createDictationSession,
  editsToOrphanText,
  type DictationSession,
  type DictationTarget,
  type ScratchOutcome,
  type SessionNotice,
  type SessionSnapshot,
  type SessionStatus,
} from "@/features/dictation/session";
export { createLineStats, type LineStats, type LineStatsSummary } from "@/features/dictation/stats";
export {
  applyVocabulary,
  buildPhraseTable,
  interpret,
  isScratchLine,
  INITIAL_INTERPRETER_STATE,
  type InterpreterState,
  type PhraseTable,
  type PhraseTableOptions,
  type TokenTrieNode,
} from "@/features/dictation/interpreter";
export { normalizePhrase } from "@/features/dictation/normalize";
export {
  defaultVocabularySettings,
  findVocabularyRefusal,
  normalizeVocabularySettings,
  type VocabularyEntry,
  type VocabularyRefusal,
  type VocabularySettings,
} from "@/features/dictation/vocabulary";
export {
  catalogCapabilities,
  defaultEntryEnabled,
  defaultSpokenPunctuationSettings,
  entriesFor,
  findAliasRefusal,
  isEntryEnabled,
  normalizeSpokenPunctuationSettings,
  type AliasRefusal,
  type PhraseAction,
  type SpokenPunctuationEntry,
  type SpokenPunctuationLanguageSettings,
  type SpokenPunctuationSettings,
} from "@/features/dictation/spoken-punctuation";
export { pickModel, useDictationStore, type DictationStoreState } from "@/features/dictation/store";
export {
  getDictation,
  resetDictationForTests,
  type DictationRuntime,
} from "@/features/dictation/runtime";
export { attachSession, dictationHub, resetDictationHubForTests } from "@/features/dictation/hub";
