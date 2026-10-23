export {
  BUNDLED_RELEASES,
  cachedBundledReleaseNotes,
  loadBundledReleaseNotes,
  releaseNotesLanguage,
} from "@/features/releases/bundled";
export {
  compareReleaseNotesParity,
  releaseNotesFile,
} from "@/features/releases/release-notes-parity";
export { compareReleaseNumbers, isNewerRelease } from "@/features/releases/compare";
export {
  checkForNewerReleases,
  fetchLocalizedReleaseNotes,
  installReleaseCheck,
  loadLocalizedNewerReleases,
  localizedReleaseNotesUrl,
  newerReleasesFrom,
  RELEASE_CHECK_INTERVAL_MS,
  RELEASES_URL,
} from "@/features/releases/release-check";
export {
  parseChangelog,
  parseInline,
  parseReleaseBody,
  SECTION_KINDS,
} from "@/features/releases/release-notes";
export type {
  InlineSegment,
  ParsedChangelog,
  ReleaseNotes,
  ReleaseSection,
  SectionKind,
} from "@/features/releases/release-notes";
export { newerReleasesIn, useReleaseStore } from "@/features/releases/store";
