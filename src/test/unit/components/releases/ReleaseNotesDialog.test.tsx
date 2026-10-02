import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockOpenExternal } = vi.hoisted(() => ({ mockOpenExternal: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { release?: string }) =>
      options?.release ? `${key}:${options.release}` : key,
    i18n: { language: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  openExternal: mockOpenExternal,
}));

import { ReleaseBadge } from "@/components/releases/ReleaseBadge";
import { ReleaseNotesDialog } from "@/components/releases/ReleaseNotesDialog";
import { APP_VERSION, DOWNLOAD_PAGE } from "@/constants";
import { BUNDLED_RELEASES } from "@/features/releases/bundled";
import type { ReleaseNotes } from "@/features/releases/release-notes";
import { useReleaseStore } from "@/features/releases/store";

const NEWER: ReleaseNotes[] = [
  {
    number: "99.1.0",
    date: "2099-01-02",
    url: "https://github.com/M4ss1ck/maibuk/releases/tag/v99.1.0",
    sections: [{ kind: "fixed", items: [[{ kind: "text", text: "A hotfix" }]] }],
  },
  {
    number: "99.0.0",
    date: "2099-01-01",
    url: "https://github.com/M4ss1ck/maibuk/releases/tag/v99.0.0",
    sections: [{ kind: null, items: [[{ kind: "text", text: "Hand-written notes" }]] }],
  },
];

function renderApp() {
  return render(
    <>
      <ReleaseBadge variant="sidebar" />
      <ReleaseNotesDialog />
    </>
  );
}

function badge(name = `releases.badge:${APP_VERSION}`) {
  return screen.getByRole("button", { name });
}

async function openFromBadge(user: ReturnType<typeof userEvent.setup>, name?: string) {
  badge(name).focus();
  await user.keyboard("{Enter}");
  return screen.getByRole("dialog", { name: "releases.title" });
}

beforeEach(() => {
  mockOpenExternal.mockReset();
  useReleaseStore.setState({ newerReleases: [], isNotesOpen: false });
});

describe("Release Notes dialog", () => {
  it("opens from the badge by keyboard with focus on the notes, newest bundled Release first", async () => {
    const user = userEvent.setup();
    renderApp();
    const dialog = await openFromBadge(user);

    const region = within(dialog).getByRole("region", { name: "releases.notesRegion" });
    expect(document.activeElement).toBe(region);
    const headings = within(region).getAllByRole("heading", { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual(BUNDLED_RELEASES.map((r) => r.number));
    expect(within(dialog).queryByText("releases.new")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /releases\.download/ })).toBeNull();
  });

  it("shows the installed Release's notes in section order", async () => {
    const user = userEvent.setup();
    renderApp();
    const dialog = await openFromBadge(user);

    const first = within(dialog).getAllByRole("article")[0];
    const kinds = BUNDLED_RELEASES[0].sections.map((s) => `releases.sections.${s.kind}`);
    expect(within(first).getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(
      kinds
    );
    expect(within(first).getAllByRole("listitem")).toHaveLength(
      BUNDLED_RELEASES[0].sections.reduce((count, s) => count + s.items.length, 0)
    );
  });

  it("closes on Escape and returns focus to the badge", async () => {
    const user = userEvent.setup();
    renderApp();
    await openFromBadge(user);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(badge());
  });

  it("prepends newer Releases marked New and downloads the newest from the footer", async () => {
    const user = userEvent.setup();
    useReleaseStore.setState({ newerReleases: NEWER });
    renderApp();
    const dialog = await openFromBadge(user, `releases.badgeWithUpdate:${APP_VERSION}`);

    const articles = within(dialog).getAllByRole("article");
    expect(articles.slice(0, 3).map((a) => within(a).getByRole("heading", { level: 3 }).textContent)).toEqual(
      ["99.1.0", "99.0.0", BUNDLED_RELEASES[0].number]
    );
    expect(within(articles[0]).getByText("releases.new")).toBeInTheDocument();
    expect(within(articles[1]).getByText("releases.new")).toBeInTheDocument();
    expect(within(articles[2]).queryByText("releases.new")).not.toBeInTheDocument();
    // Notes that did not parse still show, without a section heading.
    expect(within(articles[1]).getByText("Hand-written notes")).toBeInTheDocument();
    expect(within(articles[1]).queryByRole("heading", { level: 4 })).toBeNull();

    const download = within(dialog).getByRole("button", { name: "releases.download:99.1.0" });
    while (document.activeElement !== download) await user.tab();
    await user.keyboard("{Enter}");
    expect(mockOpenExternal).toHaveBeenCalledWith(NEWER[0].url);
  });

  it("keeps Tab inside the dialog", async () => {
    const user = userEvent.setup();
    useReleaseStore.setState({ newerReleases: NEWER });
    renderApp();
    const dialog = await openFromBadge(user, `releases.badgeWithUpdate:${APP_VERSION}`);

    for (let press = 0; press < 6; press++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("opens the older Releases page by keyboard", async () => {
    const user = userEvent.setup();
    renderApp();
    const dialog = await openFromBadge(user);

    const older = within(dialog).getByRole("link", { name: "releases.olderReleases" });
    while (document.activeElement !== older) await user.tab();
    await user.keyboard("{Enter}");
    expect(mockOpenExternal).toHaveBeenCalledWith(DOWNLOAD_PAGE);
  });

  it("adds a Release found while the dialog is open", async () => {
    const user = userEvent.setup();
    renderApp();
    const dialog = await openFromBadge(user);

    act(() => useReleaseStore.setState({ newerReleases: [NEWER[0]] }));
    expect(within(dialog).getAllByRole("heading", { level: 3 })[0]).toHaveTextContent("99.1.0");
    expect(within(dialog).getByRole("button", { name: "releases.download:99.1.0" })).toBeVisible();
  });
});
