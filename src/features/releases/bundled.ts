import changelog from "/CHANGELOG.md?raw";
import { parseChangelog, type ReleaseNotes } from "@/features/releases/release-notes";

/** The Release Notes this build shipped with, newest first. */
export const BUNDLED_RELEASES: readonly ReleaseNotes[] = parseChangelog(changelog).releases;
