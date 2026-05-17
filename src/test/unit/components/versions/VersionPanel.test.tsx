import { render, screen, waitFor } from "@testing-library/react";
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

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string) => {
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
      versions,
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
});
