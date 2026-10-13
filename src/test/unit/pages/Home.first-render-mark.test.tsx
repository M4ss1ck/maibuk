import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildBook } from "@/test/support/fixtures";

const { mockLoadBooks, mockNavigate, storeState } = vi.hoisted(() => ({
  mockLoadBooks: vi.fn(),
  mockNavigate: vi.fn(),
  storeState: {
    books: [] as ReturnType<typeof buildBook>[],
    isLoading: false,
  },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: "/", state: null }),
  };
});

vi.mock("@/features/books/store", () => ({
  useBookStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      books: storeState.books,
      isLoading: storeState.isLoading,
      loadBooks: mockLoadBooks,
      createBook: vi.fn(),
      updateBook: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock("@/lib/platform", () => ({
  IS_WEB: false,
  isMac: () => false,
  getOS: async () => ({ locale: async () => "en-US" }),
  getDialog: vi.fn(),
  getFileSystem: vi.fn(),
  getWebDialog: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

const alpha = buildBook({ id: "alpha", title: "Alpha", status: "draft" });

const timing = performance as unknown as Record<string, unknown>;
const originalMark = timing.mark;

const mark = vi.fn();

/** A fresh `@/pages/Home` module, so the page-load mark flag starts clean. */
async function renderHome() {
  vi.resetModules();
  const { Home } = await import("@/pages/Home");
  return { Home, view: render(<Home />) };
}

beforeEach(() => {
  mark.mockClear();
  timing.mark = mark;
  storeState.books = [alpha];
  storeState.isLoading = false;
});

afterEach(() => {
  if (originalMark === undefined) delete timing.mark;
  else timing.mark = originalMark;
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Home first-render mark", () => {
  it("marks app.gallery.first-render once across two mounts when the gate is on", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_PLUGIN_BENCH", undefined);

    const first = await renderHome();
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());

    expect(mark).toHaveBeenCalledTimes(1);
    expect(mark).toHaveBeenCalledWith("app.gallery.first-render");

    // Re-mount the same module's Gallery: the page-load flag must hold.
    first.view.unmount();
    render(<first.Home />);
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());

    // The flag guards a remount inside the same page load.
    expect(mark).toHaveBeenCalledTimes(1);
  });

  it("marks in a production bench build with VITE_PLUGIN_BENCH=1", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_PLUGIN_BENCH", "1");

    await renderHome();
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());

    expect(mark).toHaveBeenCalledWith("app.gallery.first-render");
  });

  it("never marks when the gate is off", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_PLUGIN_BENCH", undefined);

    await renderHome();
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());

    expect(mark).not.toHaveBeenCalled();
  });

  it("waits for content, never marking the loading spinner", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_PLUGIN_BENCH", undefined);
    storeState.books = [];
    storeState.isLoading = true;

    const { Home, view } = await renderHome();
    await waitFor(() => expect(mockLoadBooks).toHaveBeenCalled());
    expect(mark).not.toHaveBeenCalled();

    storeState.isLoading = false;
    view.rerender(<Home />);
    await waitFor(() => expect(screen.getByText("books.noBooks")).toBeInTheDocument());

    expect(mark).toHaveBeenCalledTimes(1);
  });
});
