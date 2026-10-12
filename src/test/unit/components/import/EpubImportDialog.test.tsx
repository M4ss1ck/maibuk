import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EpubImportDialog } from "@/components/import/EpubImportDialog";

const { mockImportEpubProject } = vi.hoisted(() => ({
  mockImportEpubProject: vi.fn(),
}));

vi.mock("../../../../features/import/epub-import-service", () => ({
  importEpubProject: mockImportEpubProject,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        "common.cancel": "Cancel",
        "import.acknowledgeWarnings": "Acknowledge compatibility warnings",
        "import.action": "Import EPUB",
        "import.reportUnsupported": "Report unsupported feature",
      };
      return translations[key] ?? String(values?.defaultValue ?? key);
    },
  }),
}));

const cleanReport = {
  issues: [],
  summary: { blocking: 0, lossy: 0, converted: 0, info: 0 },
};

const blockingReport = {
  issues: [{ severity: "blocking" as const, code: "encrypted-epub", message: "Encrypted EPUB" }],
  summary: { blocking: 1, lossy: 0, converted: 0, info: 0 },
};

const lossyReport = {
  issues: [{ severity: "lossy" as const, code: "script", message: "Scripts removed" }],
  summary: { blocking: 0, lossy: 1, converted: 0, info: 0 },
};

const preview = {
  title: "Imported Book",
  author: "Author",
  language: "en",
  chapterCount: 2,
  assetCount: 3,
  styleCount: 1,
  metadataCount: 5,
};

function renderDialog(props = {}) {
  return render(
    <EpubImportDialog
      isOpen
      bytes={new Uint8Array([1, 2, 3])}
      fileName="book.epub"
      report={cleanReport}
      preview={preview}
      onClose={vi.fn()}
      onImported={vi.fn()}
      {...props}
    />
  );
}

describe("EpubImportDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockImportEpubProject.mockResolvedValue({ bookId: "book-1" });
    vi.spyOn(window, "open").mockImplementation(() => null);
  });

  it("shows a clean import preview and enabled import action", () => {
    renderDialog();

    expect(screen.getByText("Imported Book")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import EPUB" })).toBeEnabled();
  });

  it("disables import when the report has blocking issues", () => {
    renderDialog({ report: blockingReport });

    expect(screen.getByText("Encrypted EPUB")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import EPUB" })).toBeDisabled();
  });

  it("requires acknowledgement for non-blocking warnings before importing", async () => {
    const user = userEvent.setup();
    renderDialog({ report: lossyReport });

    const importButton = screen.getByRole("button", { name: "Import EPUB" });
    expect(importButton).toBeDisabled();

    await user.click(screen.getByRole("switch", { name: "Acknowledge compatibility warnings" }));

    expect(importButton).toBeEnabled();
  });

  it("opens a GitHub issue URL with diagnostics and no book content", async () => {
    const user = userEvent.setup();
    renderDialog({
      report: {
        issues: [
          {
            severity: "lossy" as const,
            code: "script",
            message: "Secret prose should not be included",
            href: "EPUB/chapter.xhtml",
          },
        ],
        summary: { blocking: 0, lossy: 1, converted: 0, info: 0 },
      },
    });

    await user.click(screen.getByRole("button", { name: "Report unsupported feature" }));

    expect(window.open).toHaveBeenCalledWith(expect.stringContaining("github.com"), "_blank");
    const openedUrl = vi.mocked(window.open).mock.calls[0][0] as string;
    expect(openedUrl).toContain("script");
    expect(openedUrl).not.toContain("Secret%20prose");
  });

  it("cancel closes without importing", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderDialog({ onClose });

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalled();
    expect(mockImportEpubProject).not.toHaveBeenCalled();
  });
});
