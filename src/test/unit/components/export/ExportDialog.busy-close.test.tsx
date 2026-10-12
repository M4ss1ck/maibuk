import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExportDialog } from "@/components/export/ExportDialog";
import { useModalStore } from "@/components/ui/modal-store";
import { buildBook, buildChapter } from "@/test/support/fixtures";

// A busy export refuses every close path: the modal's registered closer (what
// a navigating Command calls, issue #328) as well as Cancel. It used to refuse
// only while "saving", so the whole generation step could be dismissed and
// the download still fired after the dialog was gone.

const { mockGenerateEpub, mockGetEpubStructure, mockListBookStyles } = vi.hoisted(() => ({
  mockGenerateEpub: vi.fn(),
  mockGetEpubStructure: vi.fn(),
  mockListBookStyles: vi.fn(),
}));

vi.mock("@/features/export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/export")>()),
  generateEpub: mockGenerateEpub,
}));

vi.mock("@/features/import/epub-project-repo", () => ({
  getEpubStructure: mockGetEpubStructure,
  listBookStyles: mockListBookStyles,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function closeThroughModalStore() {
  const { modalIds, closers } = useModalStore.getState();
  const close = closers[modalIds[modalIds.length - 1]];
  expect(close).toBeDefined();
  act(() => close());
}

async function renderAndStartExport(onClose: () => void) {
  const user = userEvent.setup();
  render(
    <ExportDialog
      isOpen
      onClose={onClose}
      book={buildBook({ id: "book-1" })}
      chapters={[buildChapter({ bookId: "book-1" })]}
    />
  );
  await vi.waitFor(() => expect(mockGetEpubStructure).toHaveBeenCalled());
  const exportButton = screen.getByRole("button", { name: "export.exportEpub" });
  exportButton.focus();
  await user.keyboard("{Enter}");
  return user;
}

describe("ExportDialog busy close", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useModalStore.setState({ modalIds: [], openCount: 0, closers: {} });
    mockGetEpubStructure.mockResolvedValue(null);
    mockListBookStyles.mockResolvedValue([]);
  });

  it("refuses to close while the EPUB is being generated", async () => {
    const generation = deferred<Blob>();
    mockGenerateEpub.mockReturnValue(generation.promise);
    const onClose = vi.fn();
    await renderAndStartExport(onClose);
    expect(await screen.findByText("export.preparingStatus")).toBeInTheDocument();

    closeThroughModalStore();

    expect(onClose).not.toHaveBeenCalled();
    expect(useModalStore.getState().modalIds).toHaveLength(1);
    expect(screen.getByText("export.preparingStatus")).toBeInTheDocument();
  });

  it("refuses to close while the file is being saved", async () => {
    const bytes = deferred<ArrayBuffer>();
    const blob = new Blob(["epub"]);
    blob.arrayBuffer = () => bytes.promise;
    mockGenerateEpub.mockResolvedValue(blob);
    const onClose = vi.fn();
    await renderAndStartExport(onClose);
    expect(await screen.findByText("export.savingStatus")).toBeInTheDocument();

    closeThroughModalStore();

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("export.savingStatus")).toBeInTheDocument();
  });

  it("closes once the export has failed", async () => {
    mockGenerateEpub.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onClose = vi.fn();
    await renderAndStartExport(onClose);
    expect(await screen.findByText("boom")).toBeInTheDocument();

    closeThroughModalStore();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when idle", async () => {
    const onClose = vi.fn();
    render(
      <ExportDialog
        isOpen
        onClose={onClose}
        book={buildBook({ id: "book-1" })}
        chapters={[buildChapter({ bookId: "book-1" })]}
      />
    );

    closeThroughModalStore();

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
