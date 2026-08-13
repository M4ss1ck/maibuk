import { describe, expect, it } from "vitest";
import {
  countBooksByStatus,
  DEFAULT_STATUS_FILTER,
  filterBooksByStatus,
} from "@/components/project/book-list-model";
import { buildBook } from "@/test/support/fixtures";

describe("book list model", () => {
  it("keeps only books whose status is selected", () => {
    const draft = buildBook({ status: "draft" });
    const archived = buildBook({ status: "archived" });

    expect(filterBooksByStatus([draft, archived], ["draft"])).toEqual([draft]);
  });

  it("preserves the incoming order of the books it keeps", () => {
    const first = buildBook({ status: "completed" });
    const skipped = buildBook({ status: "archived" });
    const last = buildBook({ status: "draft" });

    expect(filterBooksByStatus([first, skipped, last], ["draft", "completed"])).toEqual([
      first,
      last,
    ]);
  });

  it("matches nothing when no status is selected", () => {
    expect(filterBooksByStatus([buildBook({ status: "draft" })], [])).toEqual([]);
  });

  it("counts every status, including those no book uses", () => {
    const books = [
      buildBook({ status: "draft" }),
      buildBook({ status: "draft" }),
      buildBook({ status: "archived" }),
    ];

    expect(countBooksByStatus(books)).toEqual({
      draft: 2,
      "in-progress": 0,
      completed: 0,
      archived: 1,
    });
  });

  it("hides archived books by default so archiving declutters the page", () => {
    expect(DEFAULT_STATUS_FILTER).not.toContain("archived");
    expect(DEFAULT_STATUS_FILTER).toEqual(["draft", "in-progress", "completed"]);
  });
});
