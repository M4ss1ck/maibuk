import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BookSnapshot } from "../../../../features/sync/types";
import type { BookVersion } from "../../../../features/versions/types";

const {
  mockDeleteVersion,
  mockFlushBeforeCompare,
  mockGetVersionSnapshot,
  mockLoadVersions,
  mockRenameVersion,
  mockRestoreVersion,
  mockSerializeBook,
} = vi.hoisted(() => ({
  mockDeleteVersion: vi.fn(),
  mockFlushBeforeCompare: vi.fn(),
  mockGetVersionSnapshot: vi.fn(),
  mockLoadVersions: vi.fn(),
  mockRenameVersion: vi.fn(),
  mockRestoreVersion: vi.fn(),
  mockSerializeBook: vi.fn(),
}));

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

let storeVersions = versions;

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
  useVersionStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      versions: storeVersions,
      isLoading: false,
      loadVersions: mockLoadVersions,
      getVersionSnapshot: mockGetVersionSnapshot,
      restoreVersion: mockRestoreVersion,
      renameVersion: mockRenameVersion,
      deleteVersion: mockDeleteVersion,
    }),
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

import { VersionPanel } from "../../../../components/versions/VersionPanel";

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

describe("VersionPanel compare", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    mockDeleteVersion.mockReset();
    mockFlushBeforeCompare.mockReset();
    mockGetVersionSnapshot.mockReset();
    mockLoadVersions.mockReset();
    mockRenameVersion.mockReset();
    mockRestoreVersion.mockReset();
    mockSerializeBook.mockReset();
    storeVersions = versions;
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

  it("paginates the list to 10 versions per page", () => {
    storeVersions = manyVersions;

    render(
      <VersionPanel
        isOpen
        onClose={() => {}}
        bookId="book-1"
        flushBeforeCompare={mockFlushBeforeCompare}
      />
    );

    expect(screen.getByText("Version 1")).toBeInTheDocument();
    expect(screen.getByText("Version 10")).toBeInTheDocument();
    expect(screen.queryByText("Version 11")).not.toBeInTheDocument();
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
  });

  it("advances and retreats through pages via the footer", () => {
    storeVersions = manyVersions;

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

    expect(screen.queryByText("Version 1")).not.toBeInTheDocument();
    expect(screen.getByText("Version 11")).toBeInTheDocument();
    expect(screen.getByText("Version 20")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Version 21")).toBeInTheDocument();
    expect(screen.getByText("Version 25")).toBeInTheDocument();
    expect(screen.queryByText("Version 20")).not.toBeInTheDocument();
    expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
  });

  it("hides the pagination footer when there is only one page", () => {
    storeVersions = versions;

    render(
      <VersionPanel
        isOpen
        onClose={() => {}}
        bookId="book-1"
        flushBeforeCompare={mockFlushBeforeCompare}
      />
    );

    expect(screen.queryByRole("button", { name: "Previous" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });
});
