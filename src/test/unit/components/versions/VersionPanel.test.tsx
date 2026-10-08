import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installArrowNavigation } from "@/lib/arrow-navigation";
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
        "common.cancel": "Cancel",
        "common.error": "Error",
        "common.loading": "Loading",
        "common.words": "words",
        "versions.autoCheckpoint": "Auto checkpoint",
        "versions.compare": "Compare",
        "versions.preview": "Preview",
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

    await user.click(screen.getByRole("button", { name: "Compare" }));

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

  it("opens a read-only preview of a version from its Preview button", async () => {
    const user = userEvent.setup();
    mockGetVersionSnapshot.mockResolvedValue(JSON.stringify(snapshot("First draft")));

    render(
      <VersionPanel
        isOpen
        onClose={() => {}}
        bookId="book-1"
        flushBeforeCompare={mockFlushBeforeCompare}
      />
    );

    await user.click(screen.getByRole("button", { name: "Preview" }));

    expect(await screen.findByRole("heading", { name: "First draft" })).toBeInTheDocument();
    expect(mockSerializeBook).not.toHaveBeenCalled();
  });

  it("moves focus through the version rows with the arrow keys", async () => {
    const user = userEvent.setup();
    setStoreVersions(manyVersions);

    render(
      <VersionPanel
        isOpen
        onClose={() => {}}
        bookId="book-1"
        flushBeforeCompare={mockFlushBeforeCompare}
      />
    );

    const rows = await screen.findAllByRole("row");
    await waitFor(() => expect(rows[0]).toHaveFocus());

    await user.keyboard("{ArrowDown}");

    expect(rows[1]).toHaveFocus();

    await user.keyboard("{ArrowUp}");

    expect(rows[0]).toHaveFocus();
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

    await user.click(screen.getByRole("button", { name: "Compare" }));

    const compareLayout = await screen.findByTestId("version-compare-layout");
    const compareBody = screen.getByTestId("version-compare-body");

    expect(compareLayout).toHaveClass("overflow-hidden", "min-h-0", "max-h-144");
    expect(compareBody).toHaveClass("flex-1", "min-h-0", "overflow-hidden");
    expect((compareLayout as HTMLElement).style.height).toBe("calc(90dvh - 9rem)");
  });

  it("opens compare from the focused row when Enter is pressed", async () => {
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

    const row = await screen.findByRole("row", { name: "First draft" });
    await waitFor(() => expect(row).toHaveFocus());

    await user.keyboard("{Enter}");

    await waitFor(() => expect(mockFlushBeforeCompare).toHaveBeenCalledTimes(1));
  });

  it("Enter on a Version row's action button presses that button, not Compare", async () => {
    const user = userEvent.setup();
    mockGetVersionSnapshot.mockResolvedValue(JSON.stringify(snapshot("First draft")));

    render(
      <VersionPanel
        isOpen
        onClose={() => {}}
        bookId="book-1"
        flushBeforeCompare={mockFlushBeforeCompare}
      />
    );

    const row = await screen.findByRole("row", { name: "First draft" });
    await waitFor(() => expect(row).toHaveFocus());
    // ADR 0025: a row's actions are reached by arrows, not Tab.
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "Preview" })).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(await screen.findByRole("heading", { name: "First draft" })).toBeInTheDocument();
    expect(mockSerializeBook).not.toHaveBeenCalled();
  });

  it("Enter on a Version row's Restore button opens the restore confirm, not Compare", async () => {
    const user = userEvent.setup();

    render(
      <VersionPanel
        isOpen
        onClose={() => {}}
        bookId="book-1"
        flushBeforeCompare={mockFlushBeforeCompare}
      />
    );

    const row = await screen.findByRole("row", { name: "First draft" });
    await waitFor(() => expect(row).toHaveFocus());
    await user.keyboard("{ArrowRight}");
    await user.keyboard("{ArrowRight}");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "Restore" })).toHaveFocus();

    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByRole("button", { name: "Restore" })).toHaveFocus());
    expect(screen.getByText("Restore this version?")).toBeInTheDocument();
    expect(mockFlushBeforeCompare).not.toHaveBeenCalled();
  });

  it("focuses the preview's Back control and returns focus to the row when it closes", async () => {
    const user = userEvent.setup();
    mockGetVersionSnapshot.mockResolvedValue(JSON.stringify(snapshot("First draft")));

    render(
      <VersionPanel
        isOpen
        onClose={() => {}}
        bookId="book-1"
        flushBeforeCompare={mockFlushBeforeCompare}
      />
    );

    const row = await screen.findByRole("row", { name: "First draft" });
    await waitFor(() => expect(row).toHaveFocus());
    await user.keyboard("{ArrowRight}");
    await user.keyboard("{Enter}");

    const back = await screen.findByRole("button", { name: "Back" });
    await waitFor(() => expect(back).toHaveFocus());

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.getByRole("row", { name: "First draft" })).toHaveFocus());
  });

  it("closing Compare with Escape returns focus to the row it opened from", async () => {
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

    const row = await screen.findByRole("row", { name: "First draft" });
    await waitFor(() => expect(row).toHaveFocus());

    await user.keyboard("{Enter}");

    const back = await screen.findByRole("button", { name: "Back" });
    await waitFor(() => expect(back).toHaveFocus());

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.getByRole("row", { name: "First draft" })).toHaveFocus());
  });

  it("moves focus to the inline confirmation and Escape returns it to the row", async () => {
    const user = userEvent.setup();

    render(
      <VersionPanel
        isOpen
        onClose={() => {}}
        bookId="book-1"
        flushBeforeCompare={mockFlushBeforeCompare}
      />
    );

    const row = await screen.findByRole("row", { name: "First draft" });
    await waitFor(() => expect(row).toHaveFocus());

    await user.keyboard("r");

    await waitFor(() => expect(screen.getByRole("button", { name: "Restore" })).toHaveFocus());

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.getByRole("row", { name: "First draft" })).toHaveFocus());
    expect(mockRestoreVersion).not.toHaveBeenCalled();
  });

  it("r on a row opens the restore confirm and Enter restores that version", async () => {
    const user = userEvent.setup();
    mockRestoreVersion.mockResolvedValue(undefined);

    render(
      <VersionPanel
        isOpen
        onClose={() => {}}
        bookId="book-1"
        flushBeforeCompare={mockFlushBeforeCompare}
      />
    );

    const row = await screen.findByRole("row", { name: "First draft" });
    await waitFor(() => expect(row).toHaveFocus());

    await user.keyboard("r");

    await waitFor(() => expect(screen.getByRole("button", { name: "Restore" })).toHaveFocus());

    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(mockRestoreVersion).toHaveBeenCalledWith("version-1", expect.anything())
    );
  });

  it("Delete on a row opens the delete confirm and confirming deletes that version", async () => {
    const user = userEvent.setup();
    mockDeleteVersion.mockResolvedValue(undefined);

    render(
      <VersionPanel
        isOpen
        onClose={() => {}}
        bookId="book-1"
        flushBeforeCompare={mockFlushBeforeCompare}
      />
    );

    const row = await screen.findByRole("row", { name: "First draft" });
    await waitFor(() => expect(row).toHaveFocus());

    await user.keyboard("{Delete}");

    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus());

    await user.keyboard("{Enter}");

    await waitFor(() => expect(mockDeleteVersion).toHaveBeenCalledWith("version-1"));
  });

  it("Escape cancels a delete and returns focus to the row", async () => {
    const user = userEvent.setup();

    render(
      <VersionPanel
        isOpen
        onClose={() => {}}
        bookId="book-1"
        flushBeforeCompare={mockFlushBeforeCompare}
      />
    );

    const row = await screen.findByRole("row", { name: "First draft" });
    await waitFor(() => expect(row).toHaveFocus());

    await user.keyboard("{Delete}");

    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus());

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.getByRole("row", { name: "First draft" })).toHaveFocus());
    expect(mockDeleteVersion).not.toHaveBeenCalled();
  });

  it("F2 opens rename on the focused row and the field keeps its keys", async () => {
    const user = userEvent.setup();
    const uninstall = installArrowNavigation();
    try {
      render(
        <VersionPanel
          isOpen
          onClose={() => {}}
          bookId="book-1"
          flushBeforeCompare={mockFlushBeforeCompare}
        />
      );

      const row = await screen.findByRole("row", { name: "First draft" });
      await waitFor(() => expect(row).toHaveFocus());

      await user.keyboard("{F2}");

      const input = screen.getByRole("textbox");
      await waitFor(() => expect(input).toHaveFocus());

      await user.clear(input);
      await user.type(input, "a b");
      expect(input).toHaveValue("a b");

      // A caret key inside the field does not move focus out of it.
      await user.keyboard("{ArrowLeft}");
      expect(input).toHaveFocus();

      await user.keyboard("{Escape}");

      await waitFor(() => expect(screen.getByRole("row", { name: "First draft" })).toHaveFocus());
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    } finally {
      uninstall();
    }
  });

  it("PageDown and PageUp page the list from the keyboard", async () => {
    const user = userEvent.setup();
    setStoreVersions(manyVersions);

    render(
      <VersionPanel
        isOpen
        onClose={() => {}}
        bookId="book-1"
        flushBeforeCompare={mockFlushBeforeCompare}
      />
    );

    const rows = await screen.findAllByRole("row");
    await waitFor(() => expect(rows[0]).toHaveFocus());

    await user.keyboard("{PageDown}");

    await waitFor(() => expect(setPageSpy).toHaveBeenCalledWith(2));
    expect(await screen.findByText("Page 2 of 3")).toBeInTheDocument();

    await user.keyboard("{PageUp}");

    await waitFor(() => expect(setPageSpy).toHaveBeenCalledWith(1));
    expect(await screen.findByText("Page 1 of 3")).toBeInTheDocument();
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
