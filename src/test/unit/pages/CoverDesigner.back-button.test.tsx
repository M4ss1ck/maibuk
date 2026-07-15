import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { coverI18nState, navigateMock } = vi.hoisted(() => ({
  coverI18nState: { language: "en" as "en" | "es" },
  navigateMock: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === "common.back") return coverI18nState.language === "es" ? "Volver" : "Back";
      return key;
    },
    i18n: { language: coverI18nState.language },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/lib/platform", () => ({
  IS_WEB: false,
  IS_TAURI: true,
  getDialog: vi.fn().mockResolvedValue({
    open: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(null),
  }),
  getFileSystem: vi.fn().mockResolvedValue({
    readFile: vi.fn().mockResolvedValue(new Uint8Array()),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readTextFile: vi.fn().mockResolvedValue(""),
    writeTextFile: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/features/books/store", () => {
  const currentBook = {
    id: "book-1",
    title: "Cover Book",
    authorName: "Test Author",
    language: "en",
    wordCount: 5000,
    status: "draft",
    createdAt: new Date(),
    updatedAt: new Date(),
    coverData: null,
  };
  const store = {
    currentBook,
    isLoading: false,
    books: [currentBook],
    error: null,
    loadBook: vi.fn().mockResolvedValue(undefined),
    loadBooks: vi.fn().mockResolvedValue(undefined),
    updateBook: vi.fn().mockResolvedValue(undefined),
    createBook: vi.fn(),
    deleteBook: vi.fn(),
  };
  const useBookStore = (selector?: (s: typeof store) => unknown) =>
    selector ? selector(store) : store;
  useBookStore.getState = () => store;
  return { useBookStore };
});

vi.mock("@/features/covers/store", () => {
  const store = {
    dirty: false,
    scene: { layers: [], doc: { width: 400, height: 600 } },
    selectedId: null,
    setScene: vi.fn(),
    addLayer: vi.fn(),
    markSaved: vi.fn(),
    removeLayer: vi.fn(),
    sendBackward: vi.fn(),
    bringForward: vi.fn(),
    select: vi.fn(),
  };
  const useCoverStore = (selector?: (s: typeof store) => unknown) =>
    selector ? selector(store) : store;
  useCoverStore.getState = () => store;
  return { useCoverStore };
});

vi.mock("@/features/covers/scene/defaults", () => ({
  createDefaultScene: () => ({ doc: { width: 400, height: 600 } }),
  createTextLayer: () => ({}),
}));

vi.mock("@/features/covers/scene/migrate", () => ({
  loadScene: () => ({ layers: [], doc: { width: 400, height: 600 } }),
}));

vi.mock("@/features/covers/export", () => ({
  dataUrlToBytes: vi.fn(),
  exportScene: vi.fn(),
  exportScenePdf: vi.fn(),
}));

vi.mock("@/components/cover-editor", () => ({
  CanvasStage: () => <div data-testid="cover-canvas-stage" />,
  Toolbar: () => null,
  LayersPanel: () => null,
  PropertiesPanel: () => null,
}));

vi.mock("@/lib/shortcuts", () => ({
  useShortcuts: vi.fn(),
}));

import { CoverDesigner } from "@/pages/CoverDesigner";

beforeEach(() => {
  coverI18nState.language = "en";
  vi.clearAllMocks();
});

describe("CoverDesigner back button", () => {
  function renderCover() {
    return render(
      <MemoryRouter initialEntries={["/book/book-1/cover"]}>
        <Routes>
          <Route path="/book/:bookId/cover" element={<CoverDesigner />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("has accessible name via aria-label", () => {
    renderCover();
    const backBtn = screen.getByRole("button", { name: "Back" });
    expect(backBtn).toBeInTheDocument();
  });

  it("navigates to the book editor on keyboard activation", async () => {
    const user = userEvent.setup();
    renderCover();
    const backBtn = screen.getByRole("button", { name: "Back" });
    backBtn.focus();
    await user.keyboard("{Enter}");
    expect(navigateMock).toHaveBeenCalledWith("/book/book-1");
  });

  it("localizes the accessible name in Spanish", () => {
    coverI18nState.language = "es";
    renderCover();
    expect(screen.getByRole("button", { name: "Volver" })).toBeInTheDocument();
  });
});
