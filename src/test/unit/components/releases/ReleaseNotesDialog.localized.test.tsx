// The localized Release Notes read the real i18n instance, so this file cannot
// live beside ReleaseNotesDialog.test.tsx, whose `vi.mock("react-i18next")` is
// hoisted for its whole module. The behavior under test is a language switch,
// which only the real instance can make.

import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { ReleaseNotesDialog } from "@/components/releases/ReleaseNotesDialog";
import { loadBundledReleaseNotes } from "@/features/releases/bundled";
import {
  checkForNewerReleases,
  localizedReleaseNotesUrl,
  RELEASES_URL,
} from "@/features/releases/release-check";
import type { ReleaseNotes } from "@/features/releases/release-notes";
import { useReleaseStore } from "@/features/releases/store";

function article(dialog: HTMLElement, release: string): HTMLElement {
  const found = within(dialog)
    .getAllByRole("article")
    .find((article) => within(article).getByRole("heading", { level: 3 }).textContent === release);
  if (!found) throw new Error(`Release ${release} is not in the dialog`);
  return found;
}

const SPANISH = /pantalla de inicio usa el tema seleccionado/;
const ENGLISH = /Startup screen uses the selected theme/;

const ENGLISH_NEWER_BULLET = /Fix the sidebar flicker/;
const SPANISH_NEWER_BULLET = /Corrige el parpadeo de la barra lateral/;

const NEWER_ENGLISH: ReleaseNotes = {
  number: "99.1.0",
  date: "2099-01-02",
  url: "https://github.com/M4ss1ck/maibuk/releases/tag/v99.1.0",
  sections: [{ kind: "fixed", items: [[{ kind: "text", text: "Fix the sidebar flicker" }]] }],
};

const SPANISH_FILE =
  "## [99.1.0] - 2099-01-02\n\n### Fixed\n- Corrige el parpadeo de la barra lateral\n";

interface FetchLog {
  fetchImpl: typeof fetch;
  urls: string[];
}

/** Answers the Releases API with `NEWER_ENGLISH`, and everything else through `file`. */
function stubFetch(file?: () => Response | Promise<Response>): FetchLog {
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url === RELEASES_URL) {
      return {
        ok: true,
        json: async () => [
          {
            tag_name: "v99.1.0",
            draft: false,
            prerelease: false,
            published_at: "2099-01-02T10:00:00Z",
            html_url: NEWER_ENGLISH.url,
            body: "### Fixed\n- Fix the sidebar flicker",
          },
        ],
      } as Response;
    }
    if (!file) throw new TypeError("no file");
    return file();
  }) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fetchImpl);
  return { fetchImpl, urls };
}

function okText(text: string): Response {
  return { ok: true, status: 200, text: async () => text } as Response;
}

function renderOpenDialog(releases: ReleaseNotes[] = []): HTMLElement {
  useReleaseStore.setState({
    newerReleases: releases,
    localizedNewerReleases: new Map(),
    isNotesOpen: true,
  });
  render(<ReleaseNotesDialog />);
  return screen.getByRole("dialog");
}

beforeEach(async () => {
  useReleaseStore.setState({
    newerReleases: [],
    localizedNewerReleases: new Map(),
    isNotesOpen: false,
  });
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

describe("Release Notes dialog in the app language", () => {
  it("renders the Spanish bullets of the bundled Releases", async () => {
    await i18n.changeLanguage("es");
    const dialog = renderOpenDialog();

    const latest = await within(dialog).findByRole("article", { name: /0\.15\.2/ });
    expect(await within(latest).findByText(SPANISH)).toBeInTheDocument();
    expect(within(latest).queryByText(ENGLISH)).not.toBeInTheDocument();

    const previous = article(dialog, "0.15.1");
    expect(
      within(previous).getByText(
        /Muestra un marcador de advertencia y el motivo de los Plugins detenidos/
      )
    ).toBeInTheDocument();
  });

  it("renders Spanish on the first render when its file is already loaded", async () => {
    await loadBundledReleaseNotes("es");
    await i18n.changeLanguage("es");

    const dialog = renderOpenDialog();

    // No `findBy` and no wait: the state starts from the parsed cache, so the
    // English bullet is never in the DOM, not even for one render.
    const latest = article(dialog, "0.15.2");
    expect(within(latest).getByText(SPANISH)).toBeInTheDocument();
    expect(within(latest).queryByText(ENGLISH)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(ENGLISH)).not.toBeInTheDocument();
  });

  it("swaps the notes when the app language changes with the dialog open", async () => {
    const dialog = renderOpenDialog();
    expect(await within(article(dialog, "0.15.2")).findByText(ENGLISH)).toBeInTheDocument();

    await act(async () => {
      await i18n.changeLanguage("es");
    });

    expect(await within(article(dialog, "0.15.2")).findByText(SPANISH)).toBeInTheDocument();
    expect(within(article(dialog, "0.15.2")).queryByText(ENGLISH)).not.toBeInTheDocument();
  });

  it("renders English for a language with no changelog file", async () => {
    await i18n.changeLanguage("fr-FR");
    const dialog = renderOpenDialog();

    expect(await within(article(dialog, "0.15.2")).findByText(ENGLISH)).toBeInTheDocument();
    expect(within(article(dialog, "0.15.2")).queryByText(SPANISH)).not.toBeInTheDocument();
  });
});

describe("Newer Releases in the app language", () => {
  const CHANGELOG_ES = localizedReleaseNotesUrl("v99.1.0", "es");

  it("renders a newer Release's Spanish bullets read from the changelog at its tag", async () => {
    await i18n.changeLanguage("es");
    const { urls } = stubFetch(() => okText(SPANISH_FILE));
    const dialog = renderOpenDialog([NEWER_ENGLISH]);

    const newer = await within(dialog).findByRole("article", { name: /99\.1\.0/ });
    expect(await within(newer).findByText(SPANISH_NEWER_BULLET)).toBeInTheDocument();
    expect(within(newer).queryByText(ENGLISH_NEWER_BULLET)).not.toBeInTheDocument();
    expect(urls).toEqual([CHANGELOG_ES]);
  });

  it("keeps the English body when the request fails", async () => {
    await i18n.changeLanguage("es");
    const { urls } = stubFetch(() => {
      throw new TypeError("offline");
    });
    const dialog = renderOpenDialog([NEWER_ENGLISH]);

    await vi.waitFor(() => expect(urls).toEqual([CHANGELOG_ES]));
    expect(within(article(dialog, "99.1.0")).getByText(ENGLISH_NEWER_BULLET)).toBeInTheDocument();
    expect(
      within(article(dialog, "99.1.0")).queryByText(SPANISH_NEWER_BULLET)
    ).not.toBeInTheDocument();
  });

  it("keeps the English body when the tag has no file for the language", async () => {
    await i18n.changeLanguage("es");
    const { urls } = stubFetch(() => ({ ok: false, status: 404 }) as Response);
    const dialog = renderOpenDialog([NEWER_ENGLISH]);

    await vi.waitFor(() => expect(urls).toEqual([CHANGELOG_ES]));
    expect(within(article(dialog, "99.1.0")).getByText(ENGLISH_NEWER_BULLET)).toBeInTheDocument();
  });

  it("keeps the English body when the file does not list the Release", async () => {
    await i18n.changeLanguage("es");
    const { urls } = stubFetch(() =>
      okText("## [99.0.0] - 2099-01-01\n\n### Fixed\n- Corrige otra cosa\n")
    );
    const dialog = renderOpenDialog([NEWER_ENGLISH]);

    await vi.waitFor(() => expect(urls).toEqual([CHANGELOG_ES]));
    expect(within(article(dialog, "99.1.0")).getByText(ENGLISH_NEWER_BULLET)).toBeInTheDocument();
  });

  it("swaps the notes on a language switch without asking GitHub for Releases again", async () => {
    const { fetchImpl, urls } = stubFetch(() => okText(SPANISH_FILE));
    await checkForNewerReleases(fetchImpl);
    const dialog = renderOpenDialog(useReleaseStore.getState().newerReleases);

    expect(
      await within(article(dialog, "99.1.0")).findByText(ENGLISH_NEWER_BULLET)
    ).toBeInTheDocument();

    await act(async () => {
      await i18n.changeLanguage("es");
    });

    expect(
      await within(article(dialog, "99.1.0")).findByText(SPANISH_NEWER_BULLET)
    ).toBeInTheDocument();
    expect(
      within(article(dialog, "99.1.0")).queryByText(ENGLISH_NEWER_BULLET)
    ).not.toBeInTheDocument();
    expect(urls.filter((url) => url === RELEASES_URL)).toHaveLength(1);
    expect(urls.filter((url) => url === CHANGELOG_ES)).toHaveLength(1);
  });

  it("asks for no changelog when the app is in English", async () => {
    const { fetchImpl, urls } = stubFetch(() => okText(SPANISH_FILE));
    await checkForNewerReleases(fetchImpl);
    const dialog = renderOpenDialog(useReleaseStore.getState().newerReleases);

    expect(
      await within(article(dialog, "99.1.0")).findByText(ENGLISH_NEWER_BULLET)
    ).toBeInTheDocument();
    expect(urls).toEqual([RELEASES_URL]);
  });
});
