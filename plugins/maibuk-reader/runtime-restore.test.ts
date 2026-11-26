// @vitest-environment jsdom
/**
 * Relaunching onto the Reading page: the runtime has no Document in memory, so
 * it reopens the one storage says was open instead of showing no Document.
 */
import { describe, expect, it, vi } from "vitest";
import { DOCUMENT_PAGE_ID, openReaderEntry, restoreCurrentDocument } from "./runtime";
import type { ReaderSession } from "./session";
import type { ShelfEntry } from "./shelf";
import { shelfEntry } from "./test-support";

function runtimeWith(entry: ShelfEntry | null = null) {
  const session = { setEntry: vi.fn() } as unknown as ReaderSession;
  return {
    session,
    runtime: {
      currentEntry: entry,
      currentDocumentId: entry?.id ?? null,
      sessions: new Map([["frame-1", session]]),
    },
  };
}

/** The runtime fields `openReaderEntry()` reads and writes. */
function emptyRuntime() {
  return {
    currentEntry: null,
    currentDocumentId: null,
    sessions: new Map<string, ReaderSession>(),
  };
}

/** The client seam `openReaderEntry()` needs: navigation only. */
function clientWith(openPage: (params: { pageId: string }) => Promise<{ status: "opened" }>) {
  return { navigation: { openPage } } as unknown as Parameters<typeof openReaderEntry>[0];
}

describe("openReaderEntry()", () => {
  it("switches every mounted Frame without navigating the host", async () => {
    const entry = shelfEntry({ id: "doc-2", grant: "grant-2", title: "Emma" });
    const first = { setEntry: vi.fn() } as unknown as ReaderSession;
    const second = { setEntry: vi.fn() } as unknown as ReaderSession;
    const runtime = {
      currentEntry: null,
      currentDocumentId: null,
      sessions: new Map([
        ["frame-1", first],
        ["frame-2", second],
      ]),
    };
    const openPage = vi.fn(async () => ({ status: "opened" as const }));

    await openReaderEntry(
      clientWith(openPage),
      { rememberCurrent: vi.fn(async () => {}) },
      runtime,
      entry
    );

    expect(first.setEntry).toHaveBeenCalledWith(entry);
    expect(second.setEntry).toHaveBeenCalledWith(entry);
    expect(openPage).not.toHaveBeenCalled();
  });

  it("navigates to the Document page on a cold open with no Frame", async () => {
    const entry = shelfEntry({ id: "doc-1", grant: "grant-1" });
    const openPage = vi.fn(async () => ({ status: "opened" as const }));

    await openReaderEntry(
      clientWith(openPage),
      { rememberCurrent: vi.fn(async () => {}) },
      emptyRuntime(),
      entry
    );

    expect(openPage).toHaveBeenCalledWith({ pageId: DOCUMENT_PAGE_ID });
  });

  it("remembers the Document before it switches", async () => {
    const entry = shelfEntry({ id: "doc-3", grant: "grant-3", title: "Persuasion" });
    const session = { setEntry: vi.fn() } as unknown as ReaderSession;
    const runtime = {
      currentEntry: null,
      currentDocumentId: null,
      sessions: new Map([["frame-1", session]]),
    };
    const rememberCurrent = vi.fn(async () => {});
    const openPage = vi.fn(async () => ({ status: "opened" as const }));

    await openReaderEntry(clientWith(openPage), { rememberCurrent }, runtime, entry);

    expect(runtime.currentEntry).toBe(entry);
    expect(runtime.currentDocumentId).toBe("doc-3");
    expect(rememberCurrent).toHaveBeenCalledWith("doc-3");
  });
});

describe("restoreCurrentDocument()", () => {
  it("reopens the remembered Document in the mounted Frame", async () => {
    const remembered = shelfEntry({ id: "doc-2", grant: "grant-2", title: "Emma" });
    const { runtime, session } = runtimeWith();
    await restoreCurrentDocument(runtime, { loadCurrent: async () => remembered });
    expect(session.setEntry).toHaveBeenCalledWith(remembered);
    expect(runtime.currentDocumentId).toBe("doc-2");
  });

  it("leaves the Frame alone when nothing was open", async () => {
    const { runtime, session } = runtimeWith();
    await restoreCurrentDocument(runtime, { loadCurrent: async () => null });
    expect(session.setEntry).not.toHaveBeenCalled();
    expect(runtime.currentEntry).toBeNull();
  });

  it("keeps a Document opened while the lookup ran", async () => {
    const opened = shelfEntry({ id: "doc-1", grant: "grant-1" });
    const { runtime, session } = runtimeWith(opened);
    await restoreCurrentDocument(runtime, {
      loadCurrent: async () => shelfEntry({ id: "doc-2", grant: "grant-2" }),
    });
    expect(session.setEntry).not.toHaveBeenCalled();
    expect(runtime.currentEntry).toBe(opened);
  });
});
