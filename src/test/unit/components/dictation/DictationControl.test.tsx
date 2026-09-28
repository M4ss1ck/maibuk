import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL_CATALOG } from "@/features/dictation/catalog";
import "@/i18n";

const toggle = vi.fn(async () => {});
const setLanguage = vi.fn(async () => {});
vi.mock("@/features/dictation/runtime", () => ({
  getDictation: async () => ({
    session: { toggle, setLanguage, languageOverride: () => null },
  }),
}));
const { useDictationStore } = await import("@/features/dictation/store");
const { DictationControl } = await import("@/components/dictation/DictationControl");

const esFast = MODEL_CATALOG.find((m) => m.languages[0] === "es" && m.tier === "fast")!.id;
const enFast = MODEL_CATALOG.find((m) => m.languages[0] === "en" && m.tier === "fast")!.id;

function renderControl() {
  return render(
    <MemoryRouter initialEntries={["/book/b1"]}>
      <Routes>
        <Route path="/book/:bookId" element={<DictationControl />} />
        <Route path="/settings" element={<p>settings page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  toggle.mockClear();
  setLanguage.mockClear();
  useDictationStore.setState({
    support: { supported: true },
    installed: [esFast, enFast],
    announcement: "",
    languageOverride: null,
    snapshot: {
      status: "idle",
      language: null,
      modelId: null,
      level: 0,
      hasTarget: true,
    },
  });
});

describe("DictationControl", () => {
  it("is not rendered where dictation is unsupported", () => {
    useDictationStore.setState({
      support: { supported: false, reason: "not_isolated" },
    });
    const { container } = renderControl();
    expect(container).toBeEmptyDOMElement();
  });

  it("toggles dictation by keyboard", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.tab();
    expect(screen.getByRole("button", { name: /start dictation/i })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("toggles dictation with Space on the focused mic button", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.tab();
    expect(screen.getByRole("button", { name: /start dictation/i })).toHaveFocus();
    await user.keyboard(" ");
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("shows the listening state as pressed with a Stop label", () => {
    useDictationStore.setState({
      snapshot: {
        status: "listening",
        language: "es",
        modelId: esFast,
        level: 0.2,
        hasTarget: true,
      },
    });
    renderControl();
    expect(screen.getByRole("button", { name: /stop dictation/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("changes language with the arrow keys and restores focus to the picker", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.tab();
    await user.tab();
    const picker = screen.getByRole("button", { name: /dictation language/i });
    expect(picker).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(setLanguage).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(picker).toHaveFocus());
  });

  it("closes the language picker with Escape and restores focus to its trigger", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.tab();
    await user.tab();
    const picker = screen.getByRole("button", { name: /dictation language/i });
    expect(picker).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(setLanguage).not.toHaveBeenCalled();
    await waitFor(() => expect(picker).toHaveFocus());
  });

  it("with no model installed, the mic leads to Settings → Dictation", async () => {
    useDictationStore.setState({ installed: [] });
    const user = userEvent.setup();
    renderControl();
    await user.tab();
    expect(screen.getByRole("button", { name: /download a dictation model/i })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("settings page")).toBeInTheDocument();
    expect(toggle).not.toHaveBeenCalled();
  });

  it("the settings button opens Settings", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.tab();
    await user.tab();
    await user.tab();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("settings page")).toBeInTheDocument();
  });

  it("announces through a polite live region", () => {
    useDictationStore.setState({ announcement: "Dictation on, Spanish" });
    renderControl();
    expect(screen.getByRole("status")).toHaveTextContent("Dictation on, Spanish");
  });
});
