import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "../../lib/platform/types";
import { Home } from "../../pages/Home";
import { useBookStore } from "../../features/books/store";
import { useChapterStore } from "../../features/chapters/store";
import { createTestDatabase } from "../support/db-test-context";
import {
  buildEncryptedEpubFixture,
  buildEpubFixture,
  buildMinimalEpubFixture,
} from "../support/epub-fixtures";

let testDb: DatabaseAdapter;

const { mockGetDatabase, mockNavigate, mockOpenWithData } = vi.hoisted(() => ({
  mockGetDatabase: vi.fn(),
  mockNavigate: vi.fn(),
  mockOpenWithData: vi.fn(),
}));

vi.mock("../../lib/db", () => ({ getDatabase: mockGetDatabase }));
vi.mock("../../lib/platform", () => ({
  IS_WEB: true,
  getDialog: vi.fn(),
  getFileSystem: vi.fn(),
  getWebDialog: vi.fn(async () => ({ openWithData: mockOpenWithData })),
}));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string, values?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "books.importEpub": "Import EPUB",
        "books.importShort": "Import",
        "books.loading": "Loading...",
        "books.newBook": "New Book",
        "books.noBooks": "No books",
        "books.noBooksButton": "Start writing",
        "books.noBooksFull": "Create your first book.",
        "books.title": "My Books",
        "common.by": "by",
        "common.cancel": "Cancel",
        "common.new": "New",
        "import.acknowledgeWarnings": "Acknowledge compatibility warnings",
        "import.action": "Import EPUB",
        "import.assets": "Assets",
        "import.chapters": "Chapters",
        "import.cleanReport": "Clean report",
        "import.compatibilityReport": "Compatibility report",
        "import.importing": "Importing...",
        "import.metadata": "Metadata",
        "import.reportUnsupported": "Report unsupported feature",
        "import.scanning": "Scanning...",
        "import.severity.blocking": "Blocking",
        "import.severity.lossy": "Lossy",
        "import.severity.converted": "Converted",
        "import.severity.info": "Info",
        "import.styles": "Styles",
        "import.title": "Import EPUB",
        "nav.downloadApp": "Download App",
      };
      return translations[key] ?? String(values?.defaultValue ?? key);
    },
  }),
}));

function buildLossyEpub(): Uint8Array {
  return buildEpubFixture({
    extraFiles: {
      "EPUB/chapter-1.xhtml": "<html><body><p>One</p></body></html>",
      "EPUB/audio/theme.mp3": new Uint8Array([1, 2, 3]),
    },
    opf: `<?xml version="1.0" encoding="UTF-8"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:title>Lossy Import</dc:title>
          <dc:creator>Author</dc:creator>
          <dc:language>en</dc:language>
        </metadata>
        <manifest>
          <item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml" />
          <item id="audio" href="audio/theme.mp3" media-type="audio/mpeg" />
        </manifest>
        <spine><itemref idref="chapter-1" /></spine>
      </package>`,
  });
}

describe("EPUB import flow", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
    mockNavigate.mockReset();
    mockOpenWithData.mockReset();
    useBookStore.setState({ books: [], currentBook: null, isLoading: false, error: null });
    useChapterStore.setState({
      chapters: [],
      currentChapter: null,
      currentBookId: null,
      isLoading: false,
      error: null,
    });
  });

  it("scans, acknowledges warnings, imports, and navigates to the editor", async () => {
    const user = userEvent.setup();
    mockOpenWithData.mockResolvedValue({ name: "lossy.epub", data: buildLossyEpub() });

    render(<Home />);

    await user.click(await screen.findByRole("button", { name: /Import EPUB/i }));
    expect(await screen.findByText("Lossy Import")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import EPUB" })).toBeDisabled();

    await user.click(screen.getByRole("switch", { name: "Acknowledge compatibility warnings" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Import EPUB" }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(expect.stringMatching(/^\/book\/.+/));
    });
  });

  it("does not import blocking EPUBs", async () => {
    const user = userEvent.setup();
    mockOpenWithData.mockResolvedValue({ name: "encrypted.epub", data: buildEncryptedEpubFixture() });

    render(<Home />);

    await user.click(await screen.findByRole("button", { name: /Import EPUB/i }));

    expect(await screen.findByText(/Encrypted or DRM-protected EPUB files cannot be imported/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import EPUB" })).toBeDisabled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("shows the imported book card after returning Home", async () => {
    const user = userEvent.setup();
    mockOpenWithData.mockResolvedValue({ name: "clean.epub", data: buildMinimalEpubFixture() });

    const { rerender } = render(<Home />);

    await user.click(await screen.findByRole("button", { name: /Import EPUB/i }));
    await screen.findByText("Fixture Book");
    await user.click(screen.getByRole("switch", { name: "Acknowledge compatibility warnings" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Import EPUB" }));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(expect.stringMatching(/^\/book\/.+/));
    });

    await useBookStore.getState().loadBooks();
    rerender(<Home />);

    expect(await screen.findByText("Fixture Book")).toBeInTheDocument();
  });
});
