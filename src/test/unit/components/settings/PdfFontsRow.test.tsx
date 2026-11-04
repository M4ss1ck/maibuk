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
  getPdfFontFiles: mockGetFiles,
  openExternal: mockOpenExternal,
}));

const { pdfFontFor } = await import("@/features/pdf-fonts/catalog");
const { usePdfFonts } = await import("@/features/pdf-fonts/store");
const { PdfFontsRow } = await import("@/components/settings/PdfFontsRow");

const REGULAR = new TextEncoder().encode("REGULAR");
const BOLD = new TextEncoder().encode("BOLD");
const regularSha = await computeChecksum(REGULAR);
const boldSha = await computeChecksum(BOLD);

const latinEntry = pdfFontFor("latin");
if (!latinEntry) throw new Error("the catalog has no Latin font");
const latin = latinEntry;
const originalFiles = { ...latin.files };

function memoryFiles(): DownloadedFiles {
  const store = new Map<string, Uint8Array>();
  return {
    read: vi.fn(async (id, name) => store.get(`${id}/${name}`) ?? null),
    write: vi.fn(async (id, name, data) => {
      store.set(`${id}/${name}`, data);
    }),
    remove: vi.fn(async (id) => {
      for (const key of [...store.keys()]) {
        if (key.startsWith(`${id}/`)) store.delete(key);
      }
    }),
  };
}

function serveCorrect() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === latin.files.regular.url) return new Response(REGULAR);
      if (url === latin.files.bold.url) return new Response(BOLD);
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
  latin.files = {
    regular: { ...originalFiles.regular, bytes: REGULAR.length, sha256: regularSha },
    bold: { ...originalFiles.bold, bytes: BOLD.length, sha256: boldSha },
  };
  mockGetFiles.mockResolvedValue(memoryFiles());
  mockOpenExternal.mockClear();
  usePdfFonts.setState({ installed: [], downloading: [], failed: [], loaded: false });
  serveCorrect();
});

afterEach(() => {
  latin.files = originalFiles;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PdfFontsRow", () => {
  it("Tab to Download, Enter downloads, and the focused button becomes Remove", async () => {
    const user = userEvent.setup();
    render(<PdfFontsRow />);

    const row = await screen.findByRole("group", { name: "Latin, Cyrillic, and Greek" });
    const download = within(row).getByRole("button", { name: "Download" });
    await tabTo(user, download);
    expect(download).toHaveFocus();

    await user.keyboard("{Enter}");

    const remove = await within(row).findByRole("button", { name: "Remove" });
    expect(remove).toBe(download);
    expect(remove).toHaveFocus();
    expect(usePdfFonts.getState().installed).toContain("latin");

    await user.keyboard("{Enter}");

    await waitFor(() => expect(usePdfFonts.getState().installed).not.toContain("latin"));
    expect(within(row).getByRole("button", { name: "Download" })).toBe(download);
    expect(download).toHaveFocus();
  });

  it("a failed download shows the failure text beside the row", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 }))
    );
    render(<PdfFontsRow />);

    const row = await screen.findByRole("group", { name: "Latin, Cyrillic, and Greek" });
    const download = within(row).getByRole("button", { name: "Download" });
    await tabTo(user, download);
    await user.keyboard("{Enter}");

    expect(await within(row).findByText("Download failed. Try again.")).toBeInTheDocument();
    expect(usePdfFonts.getState().installed).not.toContain("latin");
    expect(download).toHaveFocus();
  });
});
