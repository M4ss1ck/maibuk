export { BUNDLED_RELEASES } from "@/features/releases/bundled";
export { compareReleaseNumbers, isNewerRelease } from "@/features/releases/compare";
export {
  checkForNewerReleases,
  installReleaseCheck,
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
export { useReleaseStore } from "@/features/releases/store";
