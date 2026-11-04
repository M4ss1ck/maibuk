import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeChecksum } from "@/lib/checksum";
import type { DownloadedFiles } from "@/lib/verified-download";
import i18n from "@/i18n";
import "@/i18n";

const { mockGetFiles, mockOpenExternal } = vi.hoisted(() => ({
  mockGetFiles: vi.fn(),
  mockOpenExternal: vi.fn(async (_url: string) => {}),
}));
vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  getSpellCheckDictionaryFiles: mockGetFiles,
  openExternal: mockOpenExternal,
}));

const { dictionaryFor } = await import("@/features/spell-check-dictionaries/catalog");
const { useSpellCheckDictionaries } = await import("@/features/spell-check-dictionaries/store");
const { SpellCheckDictionariesRow } = await import(
  "@/components/settings/SpellCheckDictionariesRow"
);

const AFF = new TextEncoder().encode("AFF");
const DIC = new TextEncoder().encode("DIC");
const affSha256 = await computeChecksum(AFF);
const dicSha256 = await computeChecksum(DIC);

const fr = dictionaryFor("fr");
if (!fr) throw new Error("the catalog has no French entry");
const frEntry = fr;
const originalAff = { ...frEntry.aff };
const originalDic = { ...frEntry.dic };

function memoryFiles(): DownloadedFiles {
  const store = new Map<string, Uint8Array>();
  return {
    read: vi.fn(async (language, name) => store.get(`${language}/${name}`) ?? null),
    write: vi.fn(async (language, name, data) => {
      store.set(`${language}/${name}`, data);
    }),
    remove: vi.fn(async (language) => {
      for (const key of [...store.keys()]) {
        if (key.startsWith(`${language}/`)) store.delete(key);
      }
    }),
  };
}

function serveCorrect() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === frEntry.aff.url) return new Response(AFF);
      if (url === frEntry.dic.url) return new Response(DIC);
      return new Response(null, { status: 404 });
    })
  );
}

async function tabTo(user: ReturnType<typeof userEvent.setup>, target: HTMLElement) {
  for (let i = 0; i < 40; i++) {
    if (document.activeElement === target) return;
    await user.tab();
  }
  expect(target).toHaveFocus();
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  frEntry.aff = { ...originalAff, bytes: AFF.length, sha256: affSha256 };
  frEntry.dic = { ...originalDic, bytes: DIC.length, sha256: dicSha256 };
  mockGetFiles.mockResolvedValue(memoryFiles());
  mockOpenExternal.mockClear();
  useSpellCheckDictionaries.setState({
    installed: [],
    downloading: [],
    failed: [],
    loaded: false,
  });
  serveCorrect();
});

afterEach(() => {
  frEntry.aff = originalAff;
  frEntry.dic = originalDic;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SpellCheckDictionariesRow", () => {
  it("Tab to Download, Enter downloads, and the focused button becomes Remove", async () => {
    const user = userEvent.setup();
    render(<SpellCheckDictionariesRow />);

    const row = await screen.findByRole("group", { name: "français" });
    const download = within(row).getByRole("button", { name: "Download" });
    await tabTo(user, download);
    expect(download).toHaveFocus();

    await user.keyboard("{Enter}");

    const remove = await within(row).findByRole("button", { name: "Remove" });
    expect(remove).toBe(download);
    expect(remove).toHaveFocus();
    expect(useSpellCheckDictionaries.getState().installed).toContain("fr");

    await user.keyboard("{Enter}");

    await waitFor(() => expect(useSpellCheckDictionaries.getState().installed).not.toContain("fr"));
    expect(within(row).getByRole("button", { name: "Download" })).toBe(download);
    expect(download).toHaveFocus();
  });

  it("a failed download shows the failure text beside the row", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 }))
    );
    render(<SpellCheckDictionariesRow />);

    const row = await screen.findByRole("group", { name: "français" });
    const download = within(row).getByRole("button", { name: "Download" });
    await tabTo(user, download);
    await user.keyboard("{Enter}");

    expect(await within(row).findByText("Download failed. Try again.")).toBeInTheDocument();
    expect(useSpellCheckDictionaries.getState().installed).not.toContain("fr");
    expect(download).toHaveFocus();
  });
});
