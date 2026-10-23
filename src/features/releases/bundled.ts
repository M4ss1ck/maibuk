import changelog from "/CHANGELOG.md?raw";
import { parseChangelog, type ReleaseNotes } from "@/features/releases/release-notes";

/** The Release Notes this build shipped with, newest first. */
export const BUNDLED_RELEASES: readonly ReleaseNotes[] = parseChangelog(changelog).releases;

/**
 * Each app language's own changelog, one lazy loader per file, keyed by the
 * locale in the file name. A new language needs its `CHANGELOG.<locale>.md`
 * and its locale file, and nothing here changes. English stays out of the
 * glob: it is already bundled above, as the fallback.
 */
const LOCALIZED_CHANGELOGS = import.meta.glob("/CHANGELOG.*.md", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

const LOCALIZED_FILE = /^\/CHANGELOG\.([^./]+)\.md$/;

function loadersByLocale(): Map<string, () => Promise<string>> {
  const loaders = new Map<string, () => Promise<string>>();
  for (const [path, load] of Object.entries(LOCALIZED_CHANGELOGS)) {
    const locale = LOCALIZED_FILE.exec(path)?.[1];
    if (locale) loaders.set(locale.toLowerCase(), load);
  }
  return loaders;
}

const LOADERS = loadersByLocale();
const PARSED = new Map<string, readonly ReleaseNotes[]>();

/** The base language the way `src/i18n.ts` reads it: "es-ES" -> "es". */
export function releaseNotesLanguage(language: string | undefined): string {
  return (language ?? "").split("-")[0].trim().toLowerCase();
}

/**
 * The bundled Release Notes in `language`, newest first. English is what an
 * author gets while their language's file loads, when their language has no
 * file, and when loading it fails: What's new is never empty.
 */
export async function loadBundledReleaseNotes(language: string): Promise<readonly ReleaseNotes[]> {
  const locale = releaseNotesLanguage(language);
  const load = locale === "en" ? undefined : LOADERS.get(locale);
  if (!load) return BUNDLED_RELEASES;
  const parsed = PARSED.get(locale);
  if (parsed) return parsed;
  try {
    const releases = parseChangelog(await load()).releases;
    PARSED.set(locale, releases);
    return releases;
  } catch (error) {
    console.warn(`Failed to load the ${locale} changelog:`, error);
    return BUNDLED_RELEASES;
  }
}
