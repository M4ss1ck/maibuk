export { useVersionStore } from "@/features/versions/store";
export { useAutoCheckpoint } from "@/features/versions/useAutoCheckpoint";
export { sanitizeChapterHtml } from "@/features/versions/sanitize";
export { diffSnapshots } from "@/features/versions/compare";
export type {
  BookVersion,
  VersionTrigger,
  CreateVersionInput,
  RestoreOptions,
} from "@/features/versions/types";
export type { BookDiff, ChapterDiff, ChapterDiffStatus } from "@/features/versions/compare";
