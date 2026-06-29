import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Home } from "@/pages/Home";

const {
  mockGetWebDialog,
  mockImportEpubProject,
  mockLoadBooks,
  mockNavigate,
  mockOpenWithData,
  mockScanEpubForImport,
} = vi.hoisted(() => ({
  mockGetWebDialog: vi.fn(),
  mockImportEpubProject: vi.fn(),
  mockLoadBooks: vi.fn(),
  mockNavigate: vi.fn(),
  mockOpenWithData: vi.fn(),
  mockScanEpubForImport: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("../../../features/books/store", () => ({
  useBookStore: () => ({
    books: [],
    isLoading: false,
    loadBooks: mockLoadBooks,
  }),
}));

vi.mock("../../../lib/platform", () => ({
  IS_WEB: true,
  getDialog: vi.fn(),
  getFileSystem: vi.fn(),
  getWebDialog: mockGetWebDialog,
}));

vi.mock("../../../features/import/epub-import-service", () => ({
  importEpubProject: mockImportEpubProject,
  scanEpubForImport: mockScanEpubForImport,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "books.importEpub": "Import EPUB",
        "books.importShort": "Import",
        "books.newBook": "New Book",
        "common.new": "New",
        "import.action": "Import EPUB",
        "import.scanning": "Scanning...",
      };
      return translations[key] ?? key;
    },
  }),
}));

describe("Home EPUB import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWebDialog.mockResolvedValue({ openWithData: mockOpenWithData });
    mockOpenWithData.mockResolvedValue({ name: "book.epub", data: new Uint8Array([1, 2, 3]) });
    mockScanEpubForImport.mockResolvedValue({
      report: { issues: [], summary: { blocking: 0, lossy: 0, converted: 0, info: 0 } },
      preview: {
        title: "Imported Book",
        author: "Author",
        language: "en",
        chapterCount: 1,
        assetCount: 0,
        styleCount: 0,
        metadataCount: 3,
      },
    });
    mockImportEpubProject.mockResolvedValue({ bookId: "book-1" });
  });

  it("renders an import EPUB action near New Book", () => {
    render(<Home />);

    expect(screen.getByRole("button", { name: /Import EPUB/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New Book/i })).toBeInTheDocument();
  });

  it("opens the web file picker and scans the selected EPUB", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: /Import EPUB/i }));

    await waitFor(() => {
      expect(mockOpenWithData).toHaveBeenCalledWith({
        filters: [{ name: "EPUB", extensions: ["epub"] }],
      });
    });
    expect(mockScanEpubForImport).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(await screen.findByText("Imported Book")).toBeInTheDocument();
  });

  it("navigates to the imported book after successful import", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: /Import EPUB/i }));
    await user.click(await screen.findByRole("button", { name: "Import EPUB" }));

    await waitFor(() => {
      expect(mockImportEpubProject).toHaveBeenCalledWith({
        bytes: new Uint8Array([1, 2, 3]),
        acknowledged: false,
      });
      expect(mockNavigate).toHaveBeenCalledWith("/book/book-1");
    });
  });
});
