import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoteEditor } from "@/components/notes/NoteEditor";
import type { Note } from "@/features/notes";

// The Note PDF warns before it starts when the built-in fonts cannot render the
// text (issue #706), and the export that follows renders the text that was
// checked, never a re-read of the editor.

const { mockGenerateDocumentPdf, mockSaveBinaryFile } = vi.hoisted(() => ({
  mockGenerateDocumentPdf: vi.fn(),
  mockSaveBinaryFile: vi.fn(),
}));

vi.mock("@/features/export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/export")>()),
  saveBinaryFile: mockSaveBinaryFile,
}));

vi.mock("@/features/export/document-pdf", () => ({
  generateDocumentPdf: mockGenerateDocumentPdf,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/lib/platform", () => ({
  IS_ANDROID: true,
  IS_DESKTOP: false,
  IS_TAURI: true,
  isMac: () => false,
  getOS: async () => ({ locale: async () => "en" }),
  createDatabase: vi.fn(() =>
    Promise.resolve({
      execute: vi.fn(() => Promise.resolve({ rowsAffected: 0 })),
      select: vi.fn(() => Promise.resolve([])),
      close: vi.fn(() => Promise.resolve()),
      exportData: vi.fn(() => Promise.resolve(new Uint8Array())),
      importData: vi.fn(() => Promise.resolve()),
    })
  ),
}));

vi.mock("@/components/ThemeToggle", () => ({
  ThemeToggle: () => null,
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/components/editor", () => ({
  Editor: ({ onExportPdf }: { onExportPdf?: () => void }) => (
    <button type="button" onClick={() => onExportPdf?.()}>
      Export PDF
    </button>
  ),
  SaveStatus: () => null,
}));

const POLISH = "Zażółć gęślą jaźń";

function buildNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    title: "Initial",
    content: "<p>Initial body</p>",
    bookId: null,
    language: "en",
    tags: [],
    pinned: false,
    order: 0,
    wordCount: 10,
    collapsedHeadings: [],
    createdAt: 1,
    updatedAt: 1,
    contentUpdatedAt: 1,
    ...overrides,
  };
}

function renderNote(note: Note) {
  const user = userEvent.setup();
  render(<NoteEditor note={note} onSave={vi.fn()} />);
  return user;
}

describe("NoteEditor PDF text warning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveBinaryFile.mockResolvedValue(true);
    mockGenerateDocumentPdf.mockResolvedValue(new Blob(["pdf"]));
  });

  it("warns before generating a PDF with unsupported text", async () => {
    const user = renderNote(buildNote({ content: `<p>${POLISH}</p>` }));

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(mockGenerateDocumentPdf).not.toHaveBeenCalled();
  });

  it("generates once from Continue, rendering the text that was checked", async () => {
    const html = `<p>${POLISH}</p>`;
    const user = renderNote(buildNote({ content: html }));

    await user.click(screen.getByRole("button", { name: "Export PDF" }));
    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: "export.pdfTextWarning.continue" }));

    await waitFor(() => expect(mockGenerateDocumentPdf).toHaveBeenCalledTimes(1));
    expect(mockGenerateDocumentPdf).toHaveBeenCalledWith(html, "Initial");
  });

  it("never generates from Cancel", async () => {
    const user = renderNote(buildNote({ content: `<p>${POLISH}</p>` }));

    await user.click(screen.getByRole("button", { name: "Export PDF" }));
    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: "export.pdfTextWarning.cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mockGenerateDocumentPdf).not.toHaveBeenCalled();
  });

  it("generates clean text with no warning", async () => {
    const user = renderNote(buildNote({ content: "<p>The tide came in</p>" }));

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    await waitFor(() => expect(mockGenerateDocumentPdf).toHaveBeenCalledTimes(1));
    expect(mockGenerateDocumentPdf).toHaveBeenCalledWith("<p>The tide came in</p>", "Initial");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
