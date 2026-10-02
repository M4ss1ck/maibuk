import { APP_VERSION } from "@/constants";
import { isNewerRelease, compareReleaseNumbers } from "@/features/releases/compare";
import { parseReleaseBody, type ReleaseNotes } from "@/features/releases/release-notes";
import { useReleaseStore } from "@/features/releases/store";
import { IS_WEB } from "@/lib/platform/target";

// Releases, not tags: a tag exists as soon as it is pushed, while release.yml
// publishes the Release only after every platform built. Drafts never reach an
// unauthenticated caller.
export const RELEASES_URL = "https://api.github.com/repos/M4ss1ck/maibuk/releases?per_page=20";

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
 * Asks GitHub for newer Releases. A failed request keeps what the last check
 * found: going offline does not take back an update the author was told about.
 */
export async function checkForNewerReleases(
  fetchImpl: typeof fetch = fetch,
  installed: string = APP_VERSION
): Promise<void> {
  try {
    const response = await fetchImpl(RELEASES_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return;
    const releases = newerReleasesFrom(await response.json(), installed);
    useReleaseStore.getState().setNewerReleases(releases);
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
