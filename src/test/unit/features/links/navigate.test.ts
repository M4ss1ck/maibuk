// src/test/unit/features/links/navigate.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "../../../support/db-test-context";

let testDb: DatabaseAdapter;
const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDatabase: mockGetDatabase }));

const { navigateToLinkTarget } = await import("@/features/links/navigate");

describe("navigateToLinkTarget", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
    const now = Math.floor(Date.now() / 1000);
    await testDb.execute(
      `INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES ('b1','Book','Author',?,?)`,
      [now, now]
    );
    await testDb.execute(
      `INSERT INTO chapters (id, book_id, title, content, "order", created_at, updated_at) VALUES ('c1','b1','Ch One','<h1 id="h-2">Sec</h1>',0,?,?)`,
      [now, now]
    );
    await testDb.execute(
      `INSERT INTO notes (id, title, content, "order", created_at, updated_at) VALUES ('n1','Note','<h1 id="h-research">Sec</h1>',0,?,?)`,
      [now, now]
    );
  });

  it("routes a note URI to the note editor", async () => {
    const navigate = vi.fn();
    await navigateToLinkTarget("maibuk://note/n1", navigate);
    expect(navigate).toHaveBeenCalledWith("/notes/n1", undefined);
  });

  it("routes a heading URI to the book editor with chapter+heading state", async () => {
    const navigate = vi.fn();
    await navigateToLinkTarget("maibuk://heading/c1/h-2", navigate);
    expect(navigate).toHaveBeenCalledWith("/book/b1", {
      state: { openChapterId: "c1", scrollToHeadingId: "h-2" },
    });
  });

  it("routes a note-heading URI to the note editor with heading state", async () => {
    const navigate = vi.fn();
    await navigateToLinkTarget("maibuk://note-heading/n1/h-research", navigate);
    expect(navigate).toHaveBeenCalledWith("/notes/n1", {
      state: { scrollToHeadingId: "h-research" },
    });
  });

  it("routes a chapter URI to the book editor", async () => {
    const navigate = vi.fn();
    await navigateToLinkTarget("maibuk://chapter/c1", navigate);
    expect(navigate).toHaveBeenCalledWith("/book/b1", {
      state: { openChapterId: "c1" },
    });
  });

  it("routes a book URI to the book editor root", async () => {
    const navigate = vi.fn();
    await navigateToLinkTarget("maibuk://book/b1", navigate);
    expect(navigate).toHaveBeenCalledWith("/book/b1", undefined);
  });

  it("navigates to fallback and fires toast for missing resource", async () => {
    const navigate = vi.fn();
    const onToast = vi.fn();
    await navigateToLinkTarget("maibuk://note/missing", navigate, onToast);
    expect(navigate).toHaveBeenCalledWith("/notes", undefined);
    expect(onToast).toHaveBeenCalledWith("deepLink.resourceGone");
  });

  it("ignores non-internal hrefs", async () => {
    const navigate = vi.fn();
    await navigateToLinkTarget("https://example.com", navigate);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("ignores malformed URIs (strict parser)", async () => {
    const navigate = vi.fn();
    await navigateToLinkTarget("maibuk://note/n1/", navigate);
    expect(navigate).not.toHaveBeenCalled();
    await navigateToLinkTarget("maibuk://note//n1", navigate);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("rejects staged book/chapter URIs as malformed", async () => {
    const navigate = vi.fn();
    await navigateToLinkTarget("maibuk://book/b1/chapter/c1", navigate);
    expect(navigate).not.toHaveBeenCalled();
    await navigateToLinkTarget("maibuk://book/b1/chapter/c1/heading/h-2", navigate);
    expect(navigate).not.toHaveBeenCalled();
    await navigateToLinkTarget("maibuk://note/n1/heading/h-research", navigate);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("handles encoded heading ids", async () => {
    const navigate = vi.fn();
    const tricky = "a/b c";
    const now = Math.floor(Date.now() / 1000);
    await testDb.execute(
      `INSERT INTO chapters (id, book_id, title, content, "order", created_at, updated_at) VALUES ('c2','b1','Ch Two','<h1 id="${tricky}">T</h1>',1,?,?)`,
      [now, now]
    );
    await navigateToLinkTarget(`maibuk://heading/c2/${encodeURIComponent(tricky)}`, navigate);
    expect(navigate).toHaveBeenCalledWith("/book/b1", {
      state: { openChapterId: "c2", scrollToHeadingId: tricky },
    });
  });
});
