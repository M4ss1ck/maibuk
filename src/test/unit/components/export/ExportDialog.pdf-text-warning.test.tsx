import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import "@/i18n";
import { ExportDialog } from "@/components/export/ExportDialog";
import { useModalStore } from "@/components/ui/modal-store";
import { buildBook, buildChapter } from "@/test/support/fixtures";

// The Book PDF warns before it starts when the built-in fonts cannot render the
// text (issue #706). EPUB never warns, and an excluded Chapter contributes no
// text to check.

const { mockGenerateEpub, mockGeneratePdf, mockGetEpubStructure, mockListBookStyles } = vi.hoisted(
  () => ({
    mockGenerateEpub: vi.fn(),
    mockGeneratePdf: vi.fn(),
    mockGetEpubStructure: vi.fn(),
    mockListBookStyles: vi.fn(),
  })
);

vi.mock("@/features/export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/export")>()),
  generateEpub: mockGenerateEpub,
}));

vi.mock("@/features/export/pdf-generator", () => ({
  generatePdf: mockGeneratePdf,
  getPdfFilename: (book: { title: string }) => `${book.title}.pdf`,
}));

vi.mock("@/features/import/epub-project-repo", () => ({
  getEpubStructure: mockGetEpubStructure,
  listBookStyles: mockListBookStyles,
}));

vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  getDialog: async () => ({ save: async () => null }),
  getFileSystem: async () => ({
    downloadFile: vi.fn(),
    writeFile: vi.fn(),
  }),
}));

const POLISH = "Zażółć gęślą jaźń";

async function renderDialog(
  chapters = [buildChapter({ bookId: "book-1", content: `<p>${POLISH}</p>` })]
) {
  const user = userEvent.setup();
  render(
    <ExportDialog isOpen onClose={vi.fn()} book={buildBook({ id: "book-1" })} chapters={chapters} />
  );
  await waitFor(() => expect(mockGetEpubStructure).toHaveBeenCalled());
  return user;
}

async function choosePdf(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "PDF" }));
}

async function pressExport(
  user: ReturnType<typeof userEvent.setup>,
  name: "Export PDF" | "Export EPUB" = "Export PDF"
) {
  const button = screen.getByRole("button", { name });
  button.focus();
  await user.keyboard("{Enter}");
}

describe("ExportDialog PDF text warning", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    useModalStore.setState({ modalIds: [], openCount: 0, closers: {} });
    await i18n.changeLanguage("en");
    mockGetEpubStructure.mockResolvedValue(null);
    mockListBookStyles.mockResolvedValue([]);
    mockGenerateEpub.mockResolvedValue(new Blob(["epub"]));
    mockGeneratePdf.mockResolvedValue(new Blob(["pdf"]));
  });

  it("warns before generating a PDF with unsupported text", async () => {
    const user = await renderDialog();
    await choosePdf(user);
    await pressExport(user);

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(mockGeneratePdf).not.toHaveBeenCalled();
  });

  it("generates once from Continue", async () => {
    const user = await renderDialog();
    await choosePdf(user);
    await pressExport(user);

    const dialog = await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: "Export PDF anyway" }));

    await waitFor(() => expect(mockGeneratePdf).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(dialog.isConnected).toBe(false));
  });

  it("never generates from Cancel and keeps the Export dialog open", async () => {
    const user = await renderDialog();
    await choosePdf(user);
    await pressExport(user);

    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mockGeneratePdf).not.toHaveBeenCalled();
    expect(screen.getByText("Export Book")).toBeInTheDocument();
  });

  it("closes only the warning on Escape and keeps the Export dialog open", async () => {
    const user = await renderDialog();
    await choosePdf(user);
    await pressExport(user);

    await screen.findByRole("alertdialog");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mockGeneratePdf).not.toHaveBeenCalled();
    expect(screen.getByText("Export Book")).toBeInTheDocument();
  });

  it("generates a clean English book PDF with no warning", async () => {
    const user = await renderDialog([
      buildChapter({ bookId: "book-1", content: "<p>The tide came in</p>" }),
    ]);
    await choosePdf(user);
    await pressExport(user);

    await waitFor(() => expect(mockGeneratePdf).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("generates a clean Spanish book PDF with no warning", async () => {
    const user = await renderDialog([
      buildChapter({ bookId: "book-1", content: "<p>¡Hola! ¿Qué tal? El niño comió piña.</p>" }),
    ]);
    await choosePdf(user);
    await pressExport(user);

    await waitFor(() => expect(mockGeneratePdf).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("ignores the text of a Chapter excluded from the export", async () => {
    const user = await renderDialog([
      buildChapter({ bookId: "book-1", content: "<p>The tide came in</p>" }),
      buildChapter({ bookId: "book-1", content: `<p>${POLISH}</p>`, isIncludedInExport: false }),
    ]);
    await choosePdf(user);
    await pressExport(user);

    await waitFor(() => expect(mockGeneratePdf).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("never warns for an EPUB with unsupported text", async () => {
    const user = await renderDialog();
    await pressExport(user, "Export EPUB");

    await waitFor(() => expect(mockGenerateEpub).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
