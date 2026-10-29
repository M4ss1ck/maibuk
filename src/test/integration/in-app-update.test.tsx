// The What's new Update flow, driven through the real dialog, badge, and Command
// against a scripted UpdaterAdapter (ADR 0037). Real installs cannot run here.

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { ReleaseBadge } from "@/components/releases/ReleaseBadge";
import { ReleaseNotesDialog } from "@/components/releases/ReleaseNotesDialog";
import { APP_VERSION } from "@/constants";
import type { ReleaseNotes } from "@/features/releases/release-notes";
import { useReleaseStore } from "@/features/releases/store";
import { resetUpdateStoreForTests, useUpdateStore } from "@/features/update/store";
import {
  UpdateError,
  type BundleType,
  type UpdateFailureReason,
  type UpdateProgressEvent,
  type UpdaterAdapter,
} from "@/lib/platform/types";

const { mockOpenExternal, fake, shutdown } = vi.hoisted(() => ({
  mockOpenExternal: vi.fn(),
  fake: { current: null as unknown },
  shutdown: vi.fn(),
}));

vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  openExternal: mockOpenExternal,
  getUpdater: async () => fake.current,
}));
vi.mock("@/lib/window/shutdown", () => ({ runShutdown: shutdown }));

const NEWER: ReleaseNotes = {
  number: "99.0.0",
  date: "2099-01-01",
  url: "https://github.com/M4ss1ck/maibuk/releases/tag/v99.0.0",
  sections: [{ kind: "fixed", items: [[{ kind: "text", text: "A hotfix" }]] }],
};

interface Script {
  bundle?: BundleType;
  feedVersion?: string | null;
  events?: UpdateProgressEvent[];
  failure?: UpdateFailureReason;
  /** Holds the download open until called. */
  gate?: Promise<void>;
}

function script(options: Script = {}) {
  const calls = { check: 0, download: 0 };
  const adapter: UpdaterAdapter = {
    bundleType: async () => options.bundle ?? "appimage",
    check: async () => {
      calls.check++;
      const version = options.feedVersion === undefined ? "99.0.0" : options.feedVersion;
      return version ? { version } : null;
    },
    downloadAndInstall: async (onProgress) => {
      calls.download++;
      for (const event of options.events ?? []) onProgress(event);
      await options.gate;
      if (options.failure) throw new UpdateError(options.failure);
    },
    restart: async () => {},
  };
  fake.current = adapter;
  return calls;
}

async function renderOpen(options: Script = {}) {
  const calls = script(options);
  await useUpdateStore.getState().loadBundleType();
  const user = userEvent.setup();
  render(
    <>
      <ReleaseBadge variant="sidebar" />
      <ReleaseNotesDialog />
    </>
  );
  await user.click(screen.getByRole("button", { name: /^Maibuk /, hidden: true }));
  return { user, calls, dialog: screen.getByRole("dialog", { name: i18n.t("releases.title") }) };
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  mockOpenExternal.mockReset();
  shutdown.mockReset().mockResolvedValue(undefined);
  resetUpdateStoreForTests();
  useReleaseStore.setState({ newerReleases: [NEWER], isNotesOpen: false });
});

afterEach(() => {
  fake.current = null;
});

describe("Update flow", () => {
  it("downloads with progress, installs, then offers Restart now or Later (Linux)", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    const { user, dialog } = await renderOpen({
      gate,
      events: [
        { kind: "started", total: 200 },
        { kind: "progress", bytes: 50 },
      ],
    });

    await user.click(within(dialog).getByRole("button", { name: "Update to 99.0.0" }));
    const bar = await within(dialog).findByRole("progressbar", { name: "Update download" });
    expect(bar).toHaveAttribute("value", "25");
    expect(within(dialog).getByRole("status")).toHaveTextContent("25% downloaded");
    // The badge shows the same progress while the dialog is closed.
    act(() => useReleaseStore.getState().closeNotes());
    expect(await screen.findByRole("button", { name: /^Maibuk /, hidden: true })).toHaveTextContent(
      "25%"
    );

    await act(async () => finish());
    await user.click(screen.getByRole("button", { name: /^Maibuk /, hidden: true }));
    expect(screen.getByRole("button", { name: /^Maibuk /, hidden: true })).toHaveTextContent(
      "Restart"
    );
    const reopened = screen.getByRole("dialog", { name: i18n.t("releases.title") });
    expect(within(reopened).getByText(/99\.0\.0 is installed/)).toBeVisible();

    await user.click(within(reopened).getByRole("button", { name: "Restart now" }));
    expect(shutdown).toHaveBeenCalledWith("restart");
  });

  it("Later closes the dialog and keeps the installed state without downloading again", async () => {
    const { user, dialog, calls } = await renderOpen();
    await user.click(within(dialog).getByRole("button", { name: "Update to 99.0.0" }));
    await user.click(await within(dialog).findByRole("button", { name: "Later" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: /^Maibuk /, hidden: true }));
    const reopened = screen.getByRole("dialog", { name: i18n.t("releases.title") });
    expect(within(reopened).queryByRole("button", { name: /^Update to/ })).toBeNull();
    expect(calls.download).toBe(1);
  });

  it("shows an indeterminate bar when the size is unknown", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    const { user, dialog } = await renderOpen({ gate, events: [{ kind: "started" }] });
    await user.click(within(dialog).getByRole("button", { name: "Update to 99.0.0" }));
    const bar = await within(dialog).findByRole("progressbar");
    expect(bar).not.toHaveAttribute("value");
    await act(async () => finish());
  });

  it.each([
    "unknown",
  ] as const)("offers only the Download Page for a %s install", async (bundle) => {
    const { user, dialog } = await renderOpen({ bundle });
    expect(within(dialog).queryByRole("button", { name: /^Update to/ })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Download page" }));
    expect(mockOpenExternal).toHaveBeenCalledWith(NEWER.url);
  });

  it.each([
    ["offline", /Check your connection/],
    ["cancelled-auth", /administrator password/],
    ["bad-signature", /signature check/],
    ["other", /The update failed/],
  ] as const)("a %s failure shows Retry and the Download Page", async (failure, message) => {
    const { user, dialog } = await renderOpen({ failure });
    await user.click(within(dialog).getByRole("button", { name: "Update to 99.0.0" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(message);
    expect(within(dialog).getByRole("button", { name: "Retry" })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Download page" })).toBeVisible();
  });

  it("sends the author to the Download Page when the feed has no entry for the install", async () => {
    const { user, dialog } = await renderOpen({ feedVersion: null });
    await user.click(within(dialog).getByRole("button", { name: "Update to 99.0.0" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      /no update for your install/
    );
  });

  it("treats a feed that lists an older Release than the Release check found as no update", async () => {
    const { user, dialog, calls } = await renderOpen({ feedVersion: "98.0.0" });
    await user.click(within(dialog).getByRole("button", { name: "Update to 99.0.0" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      /no update for your install/
    );
    expect(calls.download).toBe(0);
  });

  it.each([
    "no-asset",
    "not-writable",
  ] as const)("a %s failure offers no Retry, only the Download page", async (failure) => {
    const { user, dialog } = await renderOpen({ failure });
    await user.click(within(dialog).getByRole("button", { name: "Update to 99.0.0" }));
    await within(dialog).findByRole("alert");
    expect(within(dialog).queryByRole("button", { name: "Retry" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Download page" })).toBeVisible();
  });

  it("closes on Escape and returns focus to the badge", async () => {
    const { user } = await renderOpen();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /^Maibuk /, hidden: true })
    );
  });

  it("retries after a failure", async () => {
    const { user, dialog, calls } = await renderOpen({ failure: "offline" });
    await user.click(within(dialog).getByRole("button", { name: "Update to 99.0.0" }));
    await user.click(await within(dialog).findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(calls.download).toBe(2));
  });

  it("ignores a second start while one is in flight", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    const { calls } = await renderOpen({ gate });
    const { start } = useUpdateStore.getState();
    void start("99.0.0");
    await waitFor(() => expect(calls.download).toBe(1));
    await start("99.0.0");
    expect(calls.check).toBe(1);
    await act(async () => finish());
  });

  it("stays in the installed state when the restart is refused", async () => {
    shutdown.mockRejectedValue(new Error("disk full"));
    const { user, dialog } = await renderOpen();
    await user.click(within(dialog).getByRole("button", { name: "Update to 99.0.0" }));
    await user.click(await within(dialog).findByRole("button", { name: "Restart now" }));
    expect(await within(dialog).findByRole("button", { name: "Restart now" })).toBeVisible();
  });

  it("is keyboard-operable from Update to Restart now", async () => {
    const { user, dialog } = await renderOpen();
    const update = within(dialog).getByRole("button", { name: "Update to 99.0.0" });
    while (document.activeElement !== update) await user.tab();
    await user.keyboard("{Enter}");
    const restart = await within(dialog).findByRole("button", { name: "Restart now" });
    while (document.activeElement !== restart) await user.tab();
    await user.keyboard("{Enter}");
    expect(shutdown).toHaveBeenCalledWith("restart");
  });

  it("reads in Spanish", async () => {
    await i18n.changeLanguage("es");
    const { user, dialog } = await renderOpen();
    await user.click(within(dialog).getByRole("button", { name: "Actualizar a 99.0.0" }));
    expect(await within(dialog).findByRole("button", { name: "Reiniciar ahora" })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Página de descarga" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Novedades/, hidden: true })).toHaveTextContent(
      APP_VERSION
    );
  });
});
