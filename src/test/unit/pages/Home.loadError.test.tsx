import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";

const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDatabase: mockGetDatabase }));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: "/", state: null }),
  };
});

vi.mock("@/lib/platform", () => ({
  IS_WEB: false,
  getOS: vi.fn(),
  isMac: () => false,
  getDialog: vi.fn(),
  getFileSystem: vi.fn(),
  getWebDialog: vi.fn(),
}));

import { Home } from "@/pages/Home";
import { useBookStore } from "@/features/books/store";

let db: DatabaseAdapter;

describe("Home when the Library cannot be read", () => {
  beforeEach(async () => {
    db = await createTestDatabase();
    await db.execute(
      `INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES ('b1', 'Kept Book', 'A', 1, 1)`
    );
    useBookStore.setState({ books: [], currentBook: null, isLoading: false, error: null });
  });

  it("shows the error instead of the empty Library, and Try again loads the Books by keyboard", async () => {
    mockGetDatabase
      .mockRejectedValueOnce(new Error("database is locked"))
      .mockResolvedValue(db);
    const user = userEvent.setup();
    render(<Home />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Maibuk couldn't open your Library");
    expect(alert).toHaveTextContent("Error: database is locked");
    expect(screen.queryByText("Your stories begin here")).not.toBeInTheDocument();

    const retry = screen.getByRole("button", { name: "Try again" });
    while (document.activeElement !== retry) await user.tab();
    await user.keyboard("{Enter}");

    expect(await screen.findByText("Kept Book")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("still shows the empty state for a Library that opened with no Books", async () => {
    await db.execute("DELETE FROM books");
    mockGetDatabase.mockResolvedValue(db);
    render(<Home />);

    expect(await screen.findByText("Your stories begin here")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
