export type {
  IndexedSearchBlock,
  SearchBlock,
  SearchError,
  SearchField,
  SearchHandoff,
  SearchItemKind,
  SearchLibraryOptions,
  SearchLibraryResult,
  SearchResult,
  SearchResultIds,
  SearchResults,
  SearchSnippet,
} from "@/features/search/types";
export {
  bookFieldBlocks,
  canvasBlocks,
  canvasCardIdsByBlock,
  chapterContentBlocks,
  noteContentBlocks,
} from "@/features/search/extract";
export {
  bookSearchStatements,
  canvasSearchStatements,
  chapterSearchStatements,
  deleteSearchChaptersStatement,
  deleteSearchItemStatement,
  noteSearchStatements,
  rebuildSearchRowsStatements,
  replaceSearchRowsStatements,
  type SearchItemText,
} from "@/features/search/statements";
export {
  SEARCH_INDEX_VERSION,
  SEARCH_INDEX_VERSION_KEY,
  awaitSearchIndexRebuild,
  ensureSearchIndex,
  installSearchIndex,
  isSearchIndexRebuilding,
  requestSearchRebuild,
  resetSearchIndexForTests,
  subscribeSearchIndexStatus,
} from "@/features/search/rebuild";
export { SEARCH_FTS_TABLE, SEARCH_TEXT_TABLE, ensureSearchSchema } from "@/features/search/schema";
export { DEFAULT_SEARCH_LIMIT, searchLibrary } from "@/features/search/search";
export {
  SEARCH_SWITCHES_STORAGE_KEY,
  useSearchSwitchesStore,
  type SearchSwitches,
} from "@/features/search/switches";
