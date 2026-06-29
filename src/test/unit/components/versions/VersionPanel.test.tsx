import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BookSnapshot } from "@/features/sync/types";
import type { BookVersion } from "@/features/versions/types";

const {
  mockDeleteVersion,
  mockFlushBeforeCompare,
  mockGetVersionSnapshot,
  mockRenameVersion,
  mockRestoreVersion,
  mockSerializeBook,
  setStoreVersions,
  loadVersionsSpy,
  setPageSpy,
  testStore,
  PAGE_SIZE,
} = vi.hoisted(() => {
  const PAGE_SIZE = 10;
  // Heads-up: we can't `import` inside vi.hoisted, so we use `require` for zustand.
  const zustand: typeof import("zustand") = require("zustand");

  const deleteFn = vi.fn();
  const flushFn = vi.fn();
  const getSnapshotFn = vi.fn();
  const renameFn = vi.fn();
  const restoreFn = vi.fn();
  const serializeFn = vi.fn();

  let allVersions: BookVersion[] = [];

  const pageOf = (page: number): BookVersion[] => {
    const start = (page - 1) * PAGE_SIZE;
    return allVersions.slice(start, start + PAGE_SIZE);
  };

  const loadFn = vi.fn(async (_bookId: string, page = 1) => {
    store.setState({
      versions: pageOf(page),
      totalCount: allVersions.length,
      currentPage: page,
      isLoading: false,
    });
  });

  const setPageFn = vi.fn(async (page: number) => {
    store.setState({
      versions: pageOf(page),
      currentPage: page,
      isLoading: false,
    });
  });

  const store = zustand.create<{
    versions: BookVersion[];
    totalCount: number;
    currentPage: number;
    pageSize: number;
    isLoading: boolean;
    loadVersions: (bookId: string, page?: number, pageSize?: number) => Promise<void>;
    setPage: (page: number) => Promise<void>;
    getVersionSnapshot: typeof getSnapshotFn;
    restoreVersion: typeof restoreFn;
    renameVersion: typeof renameFn;
    deleteVersion: typeof deleteFn;
  }>(() => ({
    versions: [],
    totalCount: 0,
    currentPage: 1,
    pageSize: PAGE_SIZE,
    isLoading: false,
    loadVersions: loadFn,
    setPage: setPageFn,
    getVersionSnapshot: getSnapshotFn,
    restoreVersion: restoreFn,
    renameVersion: renameFn,
    deleteVersion: deleteFn,
  }));

  return {
    mockDeleteVersion: deleteFn,
    mockFlushBeforeCompare: flushFn,
    mockGetVersionSnapshot: getSnapshotFn,
    mockRenameVersion: renameFn,
    mockRestoreVersion: restoreFn,
    mockSerializeBook: serializeFn,
    loadVersionsSpy: loadFn,
    setPageSpy: setPageFn,
    testStore: store,
    setStoreVersions: (next: BookVersion[]) => {
      allVersions = next;
      store.setState({
        versions: pageOf(1),
        totalCount: next.length,
        currentPage: 1,
        isLoading: false,
      });
    },
    PAGE_SIZE,
  };
});

const versions: BookVersion[] = [
  {
    id: "version-1",
    bookId: "book-1",
    name: "First draft",
    wordCount: 100,
    checksum: "checksum-1",
    triggerType: "manual",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    syncedAt: null,
  },
];

const manyVersions: BookVersion[] = Array.from({ length: 25 }, (_, index) => ({
  id: `version-${index + 1}`,
  bookId: "book-1",
  name: `Version ${index + 1}`,
  wordCount: 100 + index,
  checksum: `checksum-${index + 1}`,
  triggerType: "manual",
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
  syncedAt: null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string, vars?: Record<string, unknown>) => {
      if (key === "versions.page") {
        return `Page ${vars?.page} of ${vars?.total}`;
      }
      const map: Record<string, string> = {
        "common.back": "Back",
        "common.error": "Error",
        "common.loading": "Loading",
        "common.words": "words",
        "versions.autoCheckpoint": "Auto checkpoint",
        "versions.compare": "Compare",
        "versions.delete": "Delete",
        "versions.deleteConfirm": "Delete this version permanently?",
        "versions.empty": "No versions yet",
        "versions.rename": "Rename",
        "versions.restore": "Restore",
        "versions.restoreConfirm": "Restore this version?",
        "versions.restoreSuccess": "Version restored",
        "versions.restoredName": "Before restore",
        "versions.previousPage": "Previous",
        "versions.nextPage": "Next",
        "versions.title": "Version history",
        "versions.trigger.manual": "Named",
      };
      return map[key] ?? key;
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("../../../../features/versions/store", () => ({
  useVersionStore: testStore,
  DEFAULT_VERSIONS_PAGE_SIZE: PAGE_SIZE,
}));

vi.mock("../../../../features/sync/serializer", () => ({
  serializeBook: mockSerializeBook,
}));

vi.mock("../../../../components/versions/VersionCompare", () => ({
  VersionCompare: ({ current, target }: { current: BookSnapshot; target: BookSnapshot }) => (
    <div data-testid="compare-view">
      {current.book.title} vs {target.book.title}
    </div>
  ),
}));

import { VersionPanel } from "@/components/versions/VersionPanel";

function snapshot(title: string): BookSnapshot {
  return {
    book: {
      id: "book-1",
      title,
      subtitle: null,
      authorName: "Author",
      description: null,
      genre: null,
      language: "en",
      coverImagePath: null,
      coverData: null,
      wordCount: 100,
      targetWordCount: null,
      status: "draft",
      createdAt: 1,
      updatedAt: 1,
      lastOpenedAt: null,
      lastChapterId: null,
    },
    chapters: [],
  };
}

describe("VersionPanel", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    mockDeleteVersion.mockReset();
    mockFlushBeforeCompare.mockReset();
    mockGetVersionSnapshot.mockReset();
    mockRenameVersion.mockReset();
    mockRestoreVersion.mockReset();
    mockSerializeBook.mockReset();
    loadVersionsSpy.mockClear();
    setPageSpy.mockClear();
    setStoreVersions(versions);
  });

  it("flushes current content, serializes current book, then compares with the saved version", async () => {
    const user = userEvent.setup();
    mockFlushBeforeCompare.mockResolvedValue(undefined);
    mockSerializeBook.mockResolvedValue(JSON.stringify(snapshot("Current")));
    mockGetVersionSnapshot.mockResolvedValue(JSON.stringify(snapshot("Saved")));

    render(
      <VersionPanel
        isOpen
        onClose={() => {}}
        bookId="book-1"
        flushBeforeCompare={mockFlushBeforeCompare}
      />
    );

    await user.click(screen.getByTitle("Compare"));

    expect(await screen.findByTestId("compare-view")).toHaveTextContent("Current vs Saved");
    expect(mockFlushBeforeCompare).toHaveBeenCalledTimes(1);
    expect(mockSerializeBook).toHaveBeenCalledWith("book-1");
    expect(mockGetVersionSnapshot).toHaveBeenCalledWith("version-1");
    expect(mockFlushBeforeCompare.mock.invocationCallOrder[0]).toBeLessThan(
      mockSerializeBook.mock.invocationCallOrder[0]
    );
    expect(mockSerializeBook.mock.invocationCallOrder[0]).toBeLessThan(
      mockGetVersionSnapshot.mock.invocationCallOrder[0]
    );
  });

  it("keeps compare controls fixed while the compare body owns scrolling", async () => {
    const user = userEvent.setup();
    mockFlushBeforeCompare.mockResolvedValue(undefined);
    mockSerializeBook.mockResolvedValue(JSON.stringify(snapshot("Current")));
    mockGetVersionSnapshot.mockResolvedValue(JSON.stringify(snapshot("Saved")));

    render(
      <VersionPanel
        isOpen
        onClose={() => {}}
        bookId="book-1"
        flushBeforeCompare={mockFlushBeforeCompare}
      />
    );

    await user.click(screen.getByTitle("Compare"));

    const compareLayout = await screen.findByTestId("version-compare-layout");
    const compareBody = screen.getByTestId("version-compare-body");

    expect(compareLayout).toHaveClass("overflow-hidden", "min-h-0");
    expect(compareBody).toHaveClass("flex-1", "min-h-0", "overflow-hidden");
  });

  it("opens compare from the focused row when Enter is pressed", async () => {
    mockFlushBeforeCompare.mockResolvedValue(undefined);
    mockSerializeBook.mockResolvedValue(JSON.stringify(snapshot("Current")));
    mockGetVersionSnapshot.mockResolvedValue(JSON.stringify(snapshot("Saved")));

    render(
      <VersionPanel
        isOpen
        onClose={() => {}}
        bookId="book-1"
        flushBeforeCompare={mockFlushBeforeCompare}
      />
    );

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    await waitFor(() => expect(mockFlushBeforeCompare).toHaveBeenCalledTimes(1));
  });

  it("requests page 1 on open and renders the store's page slice", async () => {
    setStoreVersions(manyVersions);

    render(
      <VersionPanel
        isOpen
        onClose={() => {}}
        bookId="book-1"
        flushBeforeCompare={mockFlushBeforeCompare}
      />
    );

    await waitFor(() => expect(loadVersionsSpy).toHaveBeenCalledWith("book-1", 1, PAGE_SIZE));
    expect(screen.getByText("Version 1")).toBeInTheDocument();
    expect(screen.getByText("Version 10")).toBeInTheDocument();
    expect(screen.queryByText("Version 11")).not.toBeInTheDocument();
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
  });

  it("navigates pages via the footer by calling the store's setPage", async () => {
    setStoreVersions(manyVersions);

    render(
      <VersionPanel
        isOpen
        onClose={() => {}}
        bookId="book-1"
        flushBeforeCompare={mockFlushBeforeCompare}
      />
    );

    const prev = screen.getByRole("button", { name: "Previous" });
    const next = screen.getByRole("button", { name: "Next" });
    expect(prev).toBeDisabled();
    expect(next).not.toBeDisabled();

    fireEvent.click(next);

    await waitFor(() => expect(setPageSpy).toHaveBeenCalledWith(2));
    await waitFor(() => expect(screen.getByText("Page 2 of 3")).toBeInTheDocument());
    expect(screen.getByText("Version 11")).toBeInTheDocument();
    expect(screen.getByText("Version 20")).toBeInTheDocument();
    expect(screen.queryByText("Version 1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(setPageSpy).toHaveBeenCalledWith(3));
    await waitFor(() => expect(screen.getByText("Page 3 of 3")).toBeInTheDocument());
    expect(screen.getByText("Version 21")).toBeInTheDocument();
    expect(screen.getByText("Version 25")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(setPageSpy).toHaveBeenCalledWith(2));
  });

  it("hides the pagination footer when there is only one page", async () => {
    setStoreVersions(versions);

    render(
      <VersionPanel
        isOpen
        onClose={() => {}}
        bookId="book-1"
        flushBeforeCompare={mockFlushBeforeCompare}
      />
    );

    await waitFor(() => expect(screen.getByText("First draft")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Previous" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });

  it("disables pagination buttons while a page is loading", async () => {
    setStoreVersions(manyVersions);

    render(
      <VersionPanel
        isOpen
        onClose={() => {}}
        bookId="book-1"
        flushBeforeCompare={mockFlushBeforeCompare}
      />
    );

    testStore.setState({ isLoading: true });

    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeDisabled());
  });
});
