import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  listA: vi.fn(),
  listB: vi.fn(),
}));

// The real registry with its Note source would read the Notes store: two fake
// sources keep every list answer under the test's control.
vi.mock("@/features/canvas/references", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/canvas/references")>();
  const { StickyNote } = await import("lucide-react");
  const sourceA: import("@/features/canvas/references").CanvasReferenceSource = {
    id: "a",
    label: "source.a",
    icon: StickyNote,
    card: "note",
    list: fake.listA,
    resolve: async () => ({}),
    open: async () => "opened",
  };
  const sourceB: import("@/features/canvas/references").CanvasReferenceSource = {
    id: "b",
    label: "source.b",
    icon: StickyNote,
    card: "note",
    list: fake.listB,
    resolve: async () => ({}),
    open: async () => "opened",
  };
  return { ...actual, useCanvasReferenceSources: () => [sourceA, sourceB] };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const { CanvasReferencePicker, CANVAS_REFERENCE_LIST_TIMEOUT_MS } = await import(
  "@/features/canvas/CanvasReferencePicker"
);

const ROWS = [
  { id: "row-alpha", title: "Alpha", subtitle: "The first one" },
  { id: "row-beta", title: "Beta" },
];

const onClose = vi.fn();
const onChoose = vi.fn();

function renderPicker() {
  return render(
    <CanvasReferencePicker isOpen canvasId="canvas-1" onClose={onClose} onChoose={onChoose} />
  );
}

function searchField() {
  return screen.getByRole("textbox", { name: "canvas.referenceSearchPlaceholder" });
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.listA.mockImplementation(async (query: string) => {
    const needle = query.trim().toLocaleLowerCase();
    return ROWS.filter((row) => row.title.toLocaleLowerCase().includes(needle));
  });
  fake.listB.mockRejectedValue(new Error("this source cannot list"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CanvasReferencePicker keyboard", () => {
  it("focuses the search field on open and lists the first source's rows", async () => {
    renderPicker();

    await waitFor(() => expect(searchField()).toHaveFocus());
    const option = await screen.findByRole("option", { name: /^Alpha/ });
    expect(option).toHaveTextContent("The first one");
    expect(screen.getByRole("option", { name: "Beta" })).toBeInTheDocument();
    expect(fake.listA).toHaveBeenCalledWith("", { canvasId: "canvas-1" });
  });

  it("filters the active list with the typed query", async () => {
    const user = userEvent.setup();
    renderPicker();
    await screen.findByRole("option", { name: /^Alpha/ });

    await user.type(searchField(), "alp");

    await waitFor(() =>
      expect(fake.listA).toHaveBeenLastCalledWith("alp", { canvasId: "canvas-1" })
    );
    await waitFor(() =>
      expect(screen.queryByRole("option", { name: "Beta" })).not.toBeInTheDocument()
    );
    expect(screen.getByRole("option", { name: /^Alpha/ })).toBeInTheDocument();

    await user.clear(searchField());
    await user.type(searchField(), "zzz");

    expect(await screen.findByText("canvas.referenceEmpty")).toBeInTheDocument();
  });

  it("walks the tabs with Tab, Shift+Tab, and the arrows, each tab listing on its own", async () => {
    const user = userEvent.setup();
    renderPicker();
    await screen.findByRole("option", { name: /^Alpha/ });

    await user.tab();
    const tabA = screen.getByRole("tab", { name: "source.a" });
    expect(tabA).toHaveFocus();

    await user.tab({ shift: true });
    expect(searchField()).toHaveFocus();

    await user.tab();
    await user.keyboard("{ArrowRight}");

    expect(await screen.findByText("canvas.referenceListFailed")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^Alpha/ })).not.toBeInTheDocument();
    expect(fake.listB).toHaveBeenCalledWith("", { canvasId: "canvas-1" });

    await user.keyboard("{ArrowLeft}");

    expect(await screen.findByRole("option", { name: /^Alpha/ })).toBeInTheDocument();
    expect(screen.queryByText("canvas.referenceListFailed")).not.toBeInTheDocument();
  });

  it("opens the highlighted row with ArrowDown and Enter", async () => {
    const user = userEvent.setup();
    renderPicker();
    await screen.findByRole("option", { name: /^Alpha/ });

    // Search field, then the tab list, then the rows.
    await user.tab();
    expect(screen.getByRole("tab", { name: "source.a" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("option", { name: /^Alpha/ })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: "Beta" })).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(onChoose).toHaveBeenCalledWith("a", ROWS[1]);
  });

  it("closes with Escape", async () => {
    const user = userEvent.setup();
    renderPicker();
    await screen.findByRole("option", { name: /^Alpha/ });

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });

  it("reports a list that rejects, in that tab only", async () => {
    const user = userEvent.setup();
    renderPicker();
    await screen.findByRole("option", { name: /^Alpha/ });

    await user.tab();
    await user.keyboard("{ArrowRight}");

    expect(await screen.findByRole("alert")).toHaveTextContent("canvas.referenceListFailed");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("reports a list that takes too long", () => {
    vi.useFakeTimers();
    fake.listA.mockImplementation(() => new Promise(() => {}));

    renderPicker();

    expect(screen.queryByText("canvas.referenceListFailed")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(CANVAS_REFERENCE_LIST_TIMEOUT_MS);
    });

    expect(screen.getByText("canvas.referenceListFailed")).toBeInTheDocument();
  });

  it("starts the next open on the first tab with an empty query", async () => {
    const user = userEvent.setup();
    const { rerender } = renderPicker();
    await screen.findByRole("option", { name: /^Alpha/ });

    await user.type(searchField(), "alp");
    await waitFor(() =>
      expect(fake.listA).toHaveBeenLastCalledWith("alp", { canvasId: "canvas-1" })
    );
    await user.tab();
    await user.keyboard("{ArrowRight}");
    await screen.findByText("canvas.referenceListFailed");

    const picker = (isOpen: boolean) => (
      <CanvasReferencePicker
        isOpen={isOpen}
        canvasId="canvas-1"
        onClose={onClose}
        onChoose={onChoose}
      />
    );
    rerender(picker(false));
    rerender(picker(true));

    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "canvas.referenceSearchPlaceholder" })
      ).toHaveValue("")
    );
    expect(await screen.findByRole("option", { name: /^Alpha/ })).toBeInTheDocument();
  });
});
