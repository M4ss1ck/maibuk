import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePdfTextWarning } from "@/components/export/PdfTextWarning";
import { ToastViewport } from "@/components/ui/Toast";
import { COMMANDS } from "@/lib/shortcut-registry";
import en from "@/locales/en.json";
import es from "@/locales/es.json";
import { computeChecksum } from "@/lib/checksum";
import type { DownloadedFiles } from "@/lib/verified-download";

// The guard before a PDF export whose text the built-in fonts cannot render:
// clean text runs at once, text a PDF font covers runs without a warning, and
// otherwise the warning offers the missing font before the export.

const { mockGetFiles, shortcutBindings } = vi.hoisted(() => ({
  mockGetFiles: vi.fn(),
  shortcutBindings: [] as { id: string; onTrigger: () => void }[],
}));

vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  getPdfFontFiles: mockGetFiles,
}));

vi.mock("@/lib/shortcuts", () => ({
  useShortcuts: (bindings: { id: string; onTrigger: () => void }[]) => {
    shortcutBindings.splice(0, shortcutBindings.length, ...bindings);
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "common.close": "Close",
        "export.pdfTextWarning.title": "Some text may be unreadable in this PDF",
        "export.pdfTextWarning.body":
          "The PDF's built-in fonts can't show some characters in this text, so they would come out garbled. EPUB and Markdown exports keep them readable.",
        "export.pdfTextWarning.continue": "Export PDF anyway",
        "export.pdfTextWarning.cancel": "Cancel",
        "export.pdfTextWarning.downloadBody":
          "Download a font and the PDF can show this text. It stays on this device.",
        "export.pdfTextWarning.download": "Download {{name}} ({{size}} MB)",
        "export.pdfTextWarning.downloading": "Downloading...",
        "export.pdfTextWarning.downloadFailed": "Download failed. Try again.",
        "settings.pdfFontLatinName": "Latin, Cyrillic, and Greek",
        "settings.pdfFontCjkName": "Chinese and Japanese",
        "settings.pdfFontDownloadFailed": "Download failed. Try again.",
        "export.downloadPdfFontDownloading": "Downloading {{name}}",
        "export.downloadPdfFontInstalled": "Installed",
      };
      const template = translations[key] ?? key;
      return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ""));
    },
    i18n: { language: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const { PDF_FONT_CATALOG, pdfFontFor } = await import("@/features/pdf-fonts/catalog");
const { usePdfFonts } = await import("@/features/pdf-fonts/store");

const POLISH = "Zażółć gęślą jaźń";
const REGULAR = new TextEncoder().encode("REGULAR");
const BOLD = new TextEncoder().encode("BOLD");
const regularSha = await computeChecksum(REGULAR);
const boldSha = await computeChecksum(BOLD);

const latinEntry = pdfFontFor("latin");
if (!latinEntry) throw new Error("the catalog has no Latin font");
const latin = latinEntry;
const originalFiles = { ...latin.files };
const originalBytes = new Map(
  PDF_FONT_CATALOG.map((font) => [
    font.id,
    Object.values(font.files).filter((file) => file !== undefined),
  ])
);

function memoryFiles(): { store: Map<string, Uint8Array>; files: DownloadedFiles } {
  const store = new Map<string, Uint8Array>();
  return {
    store,
    files: {
      read: vi.fn(async (id, name) => store.get(`${id}/${name}`) ?? null),
      write: vi.fn(async (id, name, data) => {
        store.set(`${id}/${name}`, data);
      }),
      remove: vi.fn(async (id) => {
        for (const key of [...store.keys()]) {
          if (key.startsWith(`${id}/`)) store.delete(key);
        }
      }),
    },
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

function Harness({ text, run }: { text: string; run: () => void }) {
  const { guardPdfText, pdfTextWarning } = usePdfTextWarning();
  return (
    <>
      <button type="button" onClick={() => guardPdfText(text, run)}>
        Export PDF
      </button>
      {pdfTextWarning}
    </>
  );
}

async function tabTo(user: ReturnType<typeof userEvent.setup>, target: HTMLElement) {
  for (let i = 0; i < 10 && document.activeElement !== target; i++) {
    await user.tab();
  }
  expect(document.activeElement).toBe(target);
}

beforeEach(() => {
  vi.clearAllMocks();
  latin.files = {
    regular: { ...originalFiles.regular, bytes: REGULAR.length, sha256: regularSha },
    bold: { ...originalFiles.bold, bytes: BOLD.length, sha256: boldSha },
  };
  mockGetFiles.mockResolvedValue(memoryFiles().files);
  usePdfFonts.setState({ installed: [], downloading: [], failed: [], loaded: false });
  serveCorrect();
});

afterEach(() => {
  latin.files = originalFiles;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("usePdfTextWarning", () => {
  it("runs at once for English text and shows no warning", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(<Harness text="The tide came in" run={run} />);

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("runs at once for Spanish text and shows no warning", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(<Harness text="¡Hola! ¿Qué tal? El niño comió piña." run={run} />);

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("runs without a warning when an installed font covers the text", async () => {
    await usePdfFonts.getState().download("latin");
    expect(usePdfFonts.getState().installed).toContain("latin");
    const user = userEvent.setup();
    const run = vi.fn();
    render(<Harness text={POLISH} run={run} />);

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("warns when the store says installed but the files are gone", async () => {
    // Web storage can evict the files after the store read the marker: the
    // guard must refresh before trusting `installed`, or it exports garbled.
    usePdfFonts.setState({ installed: ["latin"], loaded: true });
    const user = userEvent.setup();
    const run = vi.fn();
    render(<Harness text={POLISH} run={run} />);

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
  });

  it("warns for text the built-in fonts cannot render and runs nothing", async () => {
    usePdfFonts.setState({ loaded: true });
    const user = userEvent.setup();
    const run = vi.fn();
    render(<Harness text={POLISH} run={run} />);

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
  });

  it("offers the missing font to download with its size", async () => {
    usePdfFonts.setState({ loaded: true });
    const user = userEvent.setup();
    render(<Harness text={POLISH} run={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("button", {
        name: /^Download Latin, Cyrillic, and Greek \(\d+ MB\)$/,
      })
    ).toBeInTheDocument();
  });

  it("downloads on Enter, then runs the export and closes the warning", async () => {
    usePdfFonts.setState({ loaded: true });
    const user = userEvent.setup();
    const run = vi.fn();
    render(<Harness text={POLISH} run={run} />);

    await user.click(screen.getByRole("button", { name: "Export PDF" }));
    const dialog = await screen.findByRole("alertdialog");
    const download = within(dialog).getByRole("button", {
      name: /^Download Latin, Cyrillic, and Greek/,
    });
    await tabTo(user, download);

    await user.keyboard("{Enter}");

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(usePdfFonts.getState().installed).toContain("latin");
  });

  it("keeps the warning and installs nothing when a file is tampered with", async () => {
    usePdfFonts.setState({ loaded: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === latin.files.regular.url) return new Response(new TextEncoder().encode("XXX"));
        if (url === latin.files.bold.url) return new Response(BOLD);
        return new Response(null, { status: 404 });
      })
    );
    const user = userEvent.setup();
    const run = vi.fn();
    render(<Harness text={POLISH} run={run} />);

    await user.click(screen.getByRole("button", { name: "Export PDF" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /^Download Latin, Cyrillic/ }));

    expect(await within(dialog).findByRole("status")).toHaveTextContent("Download failed");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
    expect(usePdfFonts.getState().installed).toEqual([]);
  });

  it("shows the warning with no download offered for an emoji", async () => {
    usePdfFonts.setState({ loaded: true });
    const user = userEvent.setup();
    const run = vi.fn();
    render(<Harness text="😊" run={run} />);

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).queryByRole("button", { name: /^Download / })).toBeNull();
    expect(
      within(dialog).getByText(/built-in fonts can't show some characters/)
    ).toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
  });

  it("lands focus in the dialog and runs exactly once from Continue by keyboard", async () => {
    usePdfFonts.setState({ loaded: true });
    const user = userEvent.setup();
    const run = vi.fn();
    render(<Harness text={POLISH} run={run} />);

    const trigger = screen.getByRole("button", { name: "Export PDF" });
    trigger.focus();
    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.contains(document.activeElement)).toBe(true);

    await tabTo(user, within(dialog).getByRole("button", { name: "Export PDF anyway" }));
    await user.keyboard("{Enter}");

    expect(run).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("runs nothing on Escape and returns focus to the trigger", async () => {
    usePdfFonts.setState({ loaded: true });
    const user = userEvent.setup();
    const run = vi.fn();
    render(<Harness text={POLISH} run={run} />);

    const trigger = screen.getByRole("button", { name: "Export PDF" });
    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("alertdialog");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(run).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it("runs nothing on Cancel and returns focus to the trigger", async () => {
    usePdfFonts.setState({ loaded: true });
    const user = userEvent.setup();
    const run = vi.fn();
    render(<Harness text={POLISH} run={run} />);

    const trigger = screen.getByRole("button", { name: "Export PDF" });
    trigger.focus();
    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("alertdialog");
    await tabTo(user, within(dialog).getByRole("button", { name: "Cancel" }));
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(run).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("PDF font Commands", () => {
  function trigger(id: string) {
    const binding = shortcutBindings.find((item) => item.id === id);
    expect(binding).toBeDefined();
    act(() => binding?.onTrigger());
  }

  it("registers both download Commands from the warning hook", () => {
    render(<Harness text="The tide came in" run={vi.fn()} />);

    expect(shortcutBindings.map((binding) => binding.id)).toEqual([
      "export.downloadPdfFontLatin",
      "export.downloadPdfFontCjk",
    ]);
  });

  it("downloads the Latin font when it is missing", async () => {
    render(<Harness text="The tide came in" run={vi.fn()} />);

    trigger("export.downloadPdfFontLatin");

    await waitFor(() => expect(usePdfFonts.getState().installed).toContain("latin"));
  });

  it("announces a Command download with the starting and finished toasts", async () => {
    render(
      <>
        <Harness text="The tide came in" run={vi.fn()} />
        <ToastViewport />
      </>
    );

    trigger("export.downloadPdfFontLatin");

    expect(await screen.findByText("Downloading Latin, Cyrillic, and Greek")).toBeInTheDocument();
    await waitFor(() => expect(usePdfFonts.getState().installed).toContain("latin"));
    expect(await screen.findByText("Installed")).toBeInTheDocument();
  });

  it("announces a failed Command download", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new TextEncoder().encode("XXX")))
    );
    render(
      <>
        <Harness text="The tide came in" run={vi.fn()} />
        <ToastViewport />
      </>
    );

    trigger("export.downloadPdfFontLatin");

    expect(await screen.findByText("Downloading Latin, Cyrillic, and Greek")).toBeInTheDocument();
    expect(await screen.findByText("Download failed. Try again.")).toBeInTheDocument();
    expect(usePdfFonts.getState().installed).toEqual([]);
  });

  it("downloads the CJK font when it is missing", async () => {
    const cjkEntry = pdfFontFor("cjk");
    if (!cjkEntry) throw new Error("the catalog has no CJK font");
    const cjk = cjkEntry;
    const originalCjk = { ...cjk.files };
    cjk.files = {
      regular: { ...originalCjk.regular, bytes: REGULAR.length, sha256: regularSha },
      bold: { ...originalCjk.bold, bytes: BOLD.length, sha256: boldSha },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === cjk.files.regular.url) return new Response(REGULAR);
        if (url === cjk.files.bold.url) return new Response(BOLD);
        return new Response(null, { status: 404 });
      })
    );
    render(<Harness text="The tide came in" run={vi.fn()} />);

    try {
      trigger("export.downloadPdfFontCjk");
      await waitFor(() => expect(usePdfFonts.getState().installed).toContain("cjk"));
    } finally {
      cjk.files = originalCjk;
    }
  });

  it("does nothing when the font is already installed", async () => {
    usePdfFonts.setState({ installed: ["latin"], loaded: true });
    render(<Harness text="The tide came in" run={vi.fn()} />);

    trigger("export.downloadPdfFontLatin");
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockGetFiles).not.toHaveBeenCalled();
    expect(usePdfFonts.getState().downloading).toEqual([]);
  });

  it("names the font and its size in both locales", () => {
    const cases = [
      ["export.downloadPdfFontLatin", "latin"],
      ["export.downloadPdfFontCjk", "cjk"],
    ] as const;
    for (const [id, fontId] of cases) {
      // The download size a label promises is the catalog's, before this file
      // shrinks the pins so a download can run.
      const files = originalBytes.get(fontId) ?? [];
      const size = `${Math.round(files.reduce((total, file) => total + file.bytes, 0) / 1_000_000)} MB`;
      for (const messages of [en, es]) {
        const label = COMMANDS[id].labelKey
          .split(".")
          .reduce<unknown>(
            (node, part) =>
              node && typeof node === "object"
                ? (node as Record<string, unknown>)[part]
                : undefined,
            messages
          );
        expect(label).toContain(size);
      }
    }
  });
});
