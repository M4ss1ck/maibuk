export type {
  IndexedSearchBlock,
  SearchBlock,
  SearchField,
  SearchItemKind,
} from "@/features/search/types";
export {
  bookFieldBlocks,
  canvasBlocks,
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
