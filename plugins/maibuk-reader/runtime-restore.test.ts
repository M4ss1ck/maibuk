/**
 * Relaunching onto the Reading page: the runtime has no Document in memory, so
 * it reopens the one storage says was open instead of showing no Document.
 */
import { describe, expect, it, vi } from "vitest";
import { restoreCurrentDocument } from "./runtime";
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
