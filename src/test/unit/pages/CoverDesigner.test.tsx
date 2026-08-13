import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { navigateMock } = vi.hoisted(() => ({
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
    t: (key: string) => key,
    i18n: { language: "en" },
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
  LayersPanel: () => <div data-testid="layers-panel" />,
  PropertiesPanel: () => <div data-testid="properties-panel" />,
}));

vi.mock("@/lib/shortcuts", () => ({
  useShortcuts: vi.fn(),
}));

import { CoverDesigner } from "@/pages/CoverDesigner";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CoverDesigner mobile panels", () => {
  it("opens and closes Layers and Properties sheets by keyboard", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/book/book-1/cover"]}>
        <Routes>
          <Route path="/book/:bookId/cover" element={<CoverDesigner />} />
        </Routes>
      </MemoryRouter>
    );

    const layersTrigger = screen.getByRole("button", { name: "cover.layers.title" });
    layersTrigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("cover-layers-sheet")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("cover-layers-sheet")).not.toBeInTheDocument();
    expect(layersTrigger).toHaveFocus();

    const propertiesTrigger = screen.getByRole("button", { name: "cover.props.title" });
    propertiesTrigger.focus();
    await user.keyboard(" ");
    expect(screen.getByTestId("cover-properties-sheet")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("cover-properties-sheet")).not.toBeInTheDocument();
    expect(propertiesTrigger).toHaveFocus();
  });

  it("keeps Back, Layers, Properties, and Save reachable at narrow widths", () => {
    render(
      <MemoryRouter initialEntries={["/book/book-1/cover"]}>
        <Routes>
          <Route path="/book/:bookId/cover" element={<CoverDesigner />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole("button", { name: "common.back" })).toBeInTheDocument();
    const layers = screen.getByRole("button", { name: "cover.layers.title" });
    const properties = screen.getByRole("button", { name: "cover.props.title" });
    expect(screen.getByRole("button", { name: "cover.saved" })).toBeInTheDocument();

    // Labels collapse to icons below sm; localized accessible names remain.
    expect(layers.querySelector("svg")).not.toBeNull();
    expect(properties.querySelector("svg")).not.toBeNull();
    expect(layers.querySelector("span")).toHaveClass("hidden", "sm:inline");
    expect(properties.querySelector("span")).toHaveClass("hidden", "sm:inline");
  });
});
