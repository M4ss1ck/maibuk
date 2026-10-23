import { APP_VERSION } from "@/constants";
import { releaseNotesLanguage } from "@/features/releases/bundled";
import { isNewerRelease, compareReleaseNumbers } from "@/features/releases/compare";
import {
  parseChangelog,
  parseReleaseBody,
  type ReleaseNotes,
} from "@/features/releases/release-notes";
import { useReleaseStore } from "@/features/releases/store";
import i18n from "@/i18n";
import { IS_WEB } from "@/lib/platform/target";

/** The repository both GitHub endpoints below read. */
const REPOSITORY = "M4ss1ck/maibuk";

// Releases, not tags: a tag exists as soon as it is pushed, while release.yml
// publishes the Release only after every platform built. Drafts never reach an
// unauthenticated caller.
export const RELEASES_URL = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=20`;

/** A language's changelog file in the repository at `tag`; raw.githubusercontent answers CORS-open. */
export function localizedChangelogUrl(tag: string, locale: string): string {
  return `https://raw.githubusercontent.com/${REPOSITORY}/${tag}/CHANGELOG.${locale}.md`;
}

/** Releases are tagged `v<number>`, and `ReleaseNotes.number` drops the `v`. */
function releaseTag(number: string): string {
  return `v${number}`;
}

/**
 * That language's Release Notes from the changelog file at `tag`, keyed by
 * Release number. English asks for nothing: its body already is the Release's
 * text. A request that fails, a missing file, and a file the grammar cannot
 * read all answer an empty map, so every caller falls back to English rather
 * than hiding the update.
 */
export async function fetchLocalizedReleaseNotes(
  language: string,
  tag: string,
  fetchImpl: typeof fetch = fetch
): Promise<Map<string, ReleaseNotes>> {
  const locale = releaseNotesLanguage(language);
  const notes = new Map<string, ReleaseNotes>();
  if (locale === "en") return notes;
  try {
    const response = await fetchImpl(localizedChangelogUrl(tag, locale));
    if (!response.ok) return notes;
    const parsed = parseChangelog(await response.text());
    if (parsed.problems.length > 0) return notes;
    for (const release of parsed.releases) notes.set(release.number, release);
  } catch {
    // Offline or a blocked host: the Release's English body still shows.
  }
  return notes;
}

const PENDING = new Map<string, Promise<Map<string, ReleaseNotes>>>();

/**
 * Reads the newer Releases' notes for `language` on demand, one request per
 * language and newest tag: the language switch and the update check share it,
 * so neither repeats the other's request. Never asks for Releases, so a
 * language switch costs no Releases API call. What the store already holds for
 * that locale is kept.
 */
export async function loadLocalizedNewerReleases(
  language: string = i18n.language,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const locale = releaseNotesLanguage(language);
  const newest = useReleaseStore.getState().newerReleases[0];
  if (locale === "en" || !newest) return;
  if (useReleaseStore.getState().localizedNewerReleases.has(locale)) return;

  const tag = releaseTag(newest.number);
  const key = `${locale}|${tag}`;
  let pending = PENDING.get(key);
  if (!pending) {
    pending = fetchLocalizedReleaseNotes(locale, tag, fetchImpl)
      .then((notes) => {
        const store = useReleaseStore.getState();
        // A check that ran meanwhile replaced the list: these notes are not its.
        if (store.newerReleases[0]?.number === newest.number) {
          store.setLocalizedNewerReleases(locale, notes);
        }
        return notes;
      })
      .finally(() => PENDING.delete(key));
    PENDING.set(key, pending);
  }
  await pending;
}

/** A hotfix should reach a long-running app within half an hour. */
export const RELEASE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Published, non-prerelease Releases newer than `installed`, newest first. */
export function newerReleasesFrom(payload: unknown, installed: string): ReleaseNotes[] {
  if (!Array.isArray(payload)) return [];
  const releases: ReleaseNotes[] = [];
  for (const entry of payload) {
    if (!isRecord(entry) || entry.draft === true || entry.prerelease === true) continue;
    if (typeof entry.tag_name !== "string" || !/^v?\d+(\.\d+)*$/.test(entry.tag_name)) continue;
    if (!isNewerRelease(entry.tag_name, installed)) continue;
    const published = typeof entry.published_at === "string" ? entry.published_at : "";
    releases.push({
      number: entry.tag_name.replace(/^v/, ""),
      date: /^\d{4}-\d{2}-\d{2}/.test(published) ? published.slice(0, 10) : null,
      sections: parseReleaseBody(typeof entry.body === "string" ? entry.body : ""),
      url:
        typeof entry.html_url === "string" && entry.html_url.startsWith("https://")
          ? entry.html_url
          : undefined,
    });
  }
  return releases.sort((a, b) => compareReleaseNumbers(b.number, a.number));
}

/**
 * Asks GitHub for newer Releases, then reads the app language's notes for the
 * newest of them. A failed request keeps what the last check found: going
 * offline does not take back an update the author was told about.
 */
export async function checkForNewerReleases(
  fetchImpl: typeof fetch = fetch,
  installed: string = APP_VERSION,
  language: string = i18n.language
): Promise<void> {
  try {
    const response = await fetchImpl(RELEASES_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return;
    const releases = newerReleasesFrom(await response.json(), installed);
    useReleaseStore.getState().setNewerReleases(releases);
    if (releases.length > 0) await loadLocalizedNewerReleases(language, fetchImpl);
  } catch {
    // Offline or rate-limited: the bundled Release Notes still show.
  }
}

interface InstallOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  isWeb?: boolean;
}

/**
 * Checks once at launch, then again whenever the app becomes visible with the
 * last check older than RELEASE_CHECK_INTERVAL_MS (a phone resumed after a day
 * in the background). The web build is served from main and has nothing to
 * download, so it never checks.
 */
export function installReleaseCheck({
  fetchImpl,
  now = Date.now,
  isWeb = IS_WEB,
}: InstallOptions = {}): () => void {
  if (isWeb || typeof document === "undefined") return () => {};

  let lastStartedAt = Number.NEGATIVE_INFINITY;
  let inFlight = false;

  const run = () => {
    if (inFlight) return;
    inFlight = true;
    lastStartedAt = now();
    void checkForNewerReleases(fetchImpl ?? fetch).finally(() => {
      inFlight = false;
    });
  };

  const onVisibilityChange = () => {
    if (document.visibilityState !== "visible") return;
    if (now() - lastStartedAt >= RELEASE_CHECK_INTERVAL_MS) run();
  };

  run();
  document.addEventListener("visibilitychange", onVisibilityChange);
  return () => document.removeEventListener("visibilitychange", onVisibilityChange);
}
