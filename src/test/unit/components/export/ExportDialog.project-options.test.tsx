import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExportDialog } from "../../../../components/export/ExportDialog";
import { buildBook, buildChapter } from "../../../support/fixtures";

const { mockGetEpubStructure, mockListBookStyles } = vi.hoisted(() => ({
  mockGetEpubStructure: vi.fn(),
  mockListBookStyles: vi.fn(),
}));

vi.mock("../../../../features/import/epub-project-repo", () => ({
  getEpubStructure: mockGetEpubStructure,
  listBookStyles: mockListBookStyles,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "common.by": "by",
        "common.cancel": "Cancel",
        "export.chapter": `${values?.count ?? 0} chapters`,
        "export.epub": "EPUB",
        "export.exportEpub": "Export EPUB",
        "export.format": "Format",
        "export.generateMaibukToc": "Generate Maibuk TOC",
        "export.includeImportedStyles": "Include imported CSS",
        "export.includeTOC": "Include table of contents",
        "export.numberedTOC": "Number chapters",
        "export.pdf": "PDF",
        "export.prependChapterTitles": "Prepend chapter titles",
        "export.projectEpubOptions": "Imported EPUB options",
        "export.title": "Export",
        "export.useMaibukStyles": "Use Maibuk default styling",
      };
      return translations[key] ?? key;
    },
  }),
}));

describe("ExportDialog project EPUB options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEpubStructure.mockResolvedValue(null);
    mockListBookStyles.mockResolvedValue([]);
  });

  it("shows project EPUB options when imported EPUB data exists", async () => {
    mockGetEpubStructure.mockResolvedValue({ id: "structure-1" });
    mockListBookStyles.mockResolvedValue([{ id: "style-1" }]);

    render(
      <ExportDialog
        isOpen
        onClose={vi.fn()}
        book={buildBook({ id: "book-1" })}
        chapters={[buildChapter({ bookId: "book-1" })]}
      />
    );

    expect(await screen.findByText("Imported EPUB options")).toBeInTheDocument();
    expect(screen.getByLabelText("Use Maibuk default styling")).toBeInTheDocument();
    expect(screen.getByLabelText("Include imported CSS")).toBeInTheDocument();
    expect(screen.getByLabelText("Generate Maibuk TOC")).toBeInTheDocument();
  });

  it("hides project EPUB options for ordinary Maibuk projects", async () => {
    render(
      <ExportDialog
        isOpen
        onClose={vi.fn()}
        book={buildBook({ id: "book-1" })}
        chapters={[buildChapter({ bookId: "book-1" })]}
      />
    );

    await vi.waitFor(() => {
      expect(mockGetEpubStructure).toHaveBeenCalledWith("book-1");
    });
    expect(screen.queryByText("Imported EPUB options")).not.toBeInTheDocument();
  });
});
